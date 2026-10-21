const db = require('./db');

async function initializeDatabase() {
  let retries = 5;
  let client;
  while (retries > 0) {
    try {
      client = await db.pool.connect();
      break;
    } catch (err) {
      console.warn(`[Database] Connection failed. Retries left: ${retries - 1}. Error: ${err.message}`);
      retries -= 1;
      if (retries === 0) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  try {
    await client.query('BEGIN');

    // 1. Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        wallet_address VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(255) NOT NULL,
        integrity_score INTEGER DEFAULT 100,
        is_mock BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Index on wallet_address for fast lookup
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_wallet_address ON users(wallet_address)
    `);

    // 2. Create user_sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        token VARCHAR(255) UNIQUE NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token)
    `);

    // 2b. Create auth_nonces table (server-issued login challenges, anti-replay)
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_nonces (
        id SERIAL PRIMARY KEY,
        nonce VARCHAR(64) UNIQUE NOT NULL,
        wallet_address VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_auth_nonces_nonce ON auth_nonces(nonce)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_auth_nonces_wallet ON auth_nonces(wallet_address)
    `);

    // Simple migration ledger so one-time migrations run exactly once
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // One-time migration (hashed_sessions_v1): session tokens are now stored
    // as SHA-256 hashes. Legacy plaintext tokens cannot be distinguished from
    // hashes, so all pre-existing sessions are invalidated once.
    const hashedSessionsMigration = await client.query(
      `SELECT 1 FROM schema_migrations WHERE name = 'hashed_sessions_v1'`
    );
    if (hashedSessionsMigration.rows.length === 0) {
      await client.query(`DELETE FROM user_sessions`);
      await client.query(`INSERT INTO schema_migrations (name) VALUES ('hashed_sessions_v1')`);
      console.log('[Database Migration] hashed_sessions_v1 applied: all legacy sessions invalidated.');
    }

    // 3. Create user_learning_paths table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_learning_paths (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(100) NOT NULL,
        level VARCHAR(100) NOT NULL,
        duration_weeks INTEGER NOT NULL,
        commitment_hours DOUBLE PRECISION NOT NULL,
        plan_data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, role)
      )
    `);

    // Migration to change unique constraint
    const checkRoleKey = await client.query(`
      SELECT 1 FROM pg_constraint WHERE conname = 'user_learning_paths_user_id_role_key'
    `);
    if (checkRoleKey.rows.length === 0) {
      try {
        await client.query(`
          ALTER TABLE user_learning_paths DROP CONSTRAINT IF EXISTS user_learning_paths_user_id_key
        `);
        await client.query(`
          ALTER TABLE user_learning_paths ADD CONSTRAINT user_learning_paths_user_id_role_key UNIQUE (user_id, role)
        `);
      } catch (migErr) {
        console.warn('[Database Migration] Migration statement failed:', migErr.message);
      }
    }

    // 4. Create user_progress table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        material_slug VARCHAR(255) NOT NULL,
        role VARCHAR(100) NOT NULL,
        status VARCHAR(50) DEFAULT 'in_progress',
        notes TEXT,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, role, material_slug)
      )
    `);

    // 5. Create quiz_results table
    await client.query(`
      CREATE TABLE IF NOT EXISTS quiz_results (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        material_slug VARCHAR(255) NOT NULL,
        quiz_type VARCHAR(100) NOT NULL,
        score DOUBLE PRECISION NOT NULL,
        total_questions INTEGER NOT NULL,
        correct_answers INTEGER NOT NULL,
        details JSONB,
        keystroke_verified BOOLEAN DEFAULT TRUE,
        keystroke_score DOUBLE PRECISION,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 6. Create user_sbts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sbts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        module_id VARCHAR(100) NOT NULL,
        tx_hash VARCHAR(255) NOT NULL,
        token_id INTEGER,
        minted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, module_id)
      )
    `);

    // Mint lifecycle (Phase 1d): pending -> confirmed | failed, plus an
    // honest 'simulated' flag distinguishing dev-only records from real ones.
    await client.query(`ALTER TABLE user_sbts ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'confirmed'`);
    await client.query(`ALTER TABLE user_sbts ADD COLUMN IF NOT EXISTS simulated BOOLEAN DEFAULT FALSE`);

    // Credential sharing + revocation (Phase 3):
    //   credential_id    — unguessable public id for share/verify URLs
    //   credential_status— active | revoked | expired | superseded, tracked
    //                     INDEPENDENTLY from the mint lifecycle `status`
    //   revoked_*        — who/when/why, kept on the row as a minimal audit trail
    //   submitted_at     — when an on-chain tx hash was recorded (watcher input)
    await client.query(`ALTER TABLE user_sbts ADD COLUMN IF NOT EXISTS credential_id UUID DEFAULT gen_random_uuid()`);
    await client.query(`ALTER TABLE user_sbts ADD COLUMN IF NOT EXISTS credential_status VARCHAR(20) DEFAULT 'active'`);
    await client.query(`ALTER TABLE user_sbts ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP`);
    await client.query(`ALTER TABLE user_sbts ADD COLUMN IF NOT EXISTS revoked_by_wallet VARCHAR(255)`);
    await client.query(`ALTER TABLE user_sbts ADD COLUMN IF NOT EXISTS revoke_reason TEXT`);
    await client.query(`ALTER TABLE user_sbts ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sbts_credential_id ON user_sbts(credential_id)`);

    // One-time migration (credential_ids_v1): backfill public credential ids
    // for rows that existed before the column was added. (PG11+ fills existing
    // rows when adding a column with a default; the explicit backfill makes
    // this deterministic and covers re-runs.)
    const credentialIdsMigration = await client.query(
      `SELECT 1 FROM schema_migrations WHERE name = 'credential_ids_v1'`
    );
    if (credentialIdsMigration.rows.length === 0) {
      await client.query(`UPDATE user_sbts SET credential_id = gen_random_uuid() WHERE credential_id IS NULL`);
      await client.query(`INSERT INTO schema_migrations (name) VALUES ('credential_ids_v1')`);
      console.log('[Database Migration] credential_ids_v1 applied: public credential ids backfilled.');
    }

    // 7. Create assessment_attempts table (server-issued quiz attempts)
    await client.query(`
      CREATE TABLE IF NOT EXISTS assessment_attempts (
        id UUID PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        material_slug VARCHAR(255) NOT NULL,
        quiz_type VARCHAR(100) NOT NULL,
        role VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'in_progress',
        questions JSONB NOT NULL,
        answer_key JSONB NOT NULL,
        voice_challenge JSONB,
        hints_used INTEGER DEFAULT 0,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        submitted_at TIMESTAMP,
        integrity JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_assessment_attempts_user ON assessment_attempts(user_id, material_slug, quiz_type)
    `);

    // 8. Create integrity_events table (append-only history of integrity score changes)
    await client.query(`
      CREATE TABLE IF NOT EXISTS integrity_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        attempt_id UUID,
        delta INTEGER NOT NULL,
        score_before INTEGER NOT NULL,
        score_after INTEGER NOT NULL,
        status VARCHAR(30) NOT NULL,
        reasons JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Server-side grading columns on quiz_results
    await client.query(`ALTER TABLE quiz_results ADD COLUMN IF NOT EXISTS attempt_id UUID`);
    await client.query(`ALTER TABLE quiz_results ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'server'`);
    await client.query(`ALTER TABLE quiz_results ADD COLUMN IF NOT EXISTS integrity_status VARCHAR(30)`);

    // One-time migration (legacy_quiz_source_v1): every quiz_results row that
    // exists today was written by the trusted client (no server attempt behind
    // it). Mark them once so the SBT gate only accepts server-graded rows.
    const legacyQuizSourceMigration = await client.query(
      `SELECT 1 FROM schema_migrations WHERE name = 'legacy_quiz_source_v1'`
    );
    if (legacyQuizSourceMigration.rows.length === 0) {
      await client.query(`UPDATE quiz_results SET source = 'legacy_client' WHERE attempt_id IS NULL`);
      await client.query(`INSERT INTO schema_migrations (name) VALUES ('legacy_quiz_source_v1')`);
      console.log('[Database Migration] legacy_quiz_source_v1 applied: pre-existing quiz_results marked as legacy_client.');
    }

    // One-time migration (sbt_legacy_simulated_v1): every user_sbts row that
    // exists today predates the mint lifecycle and was created under the old
    // silent-fallback policy (real config missing/failing quietly produced mock
    // hashes). Their provenance cannot be proven either way, so we conservatively
    // label them simulated — claiming them as on-chain would be dishonest.
    const legacySbtMigration = await client.query(
      `SELECT 1 FROM schema_migrations WHERE name = 'sbt_legacy_simulated_v1'`
    );
    if (legacySbtMigration.rows.length === 0) {
      await client.query(`UPDATE user_sbts SET simulated = TRUE WHERE status = 'confirmed'`);
      await client.query(`INSERT INTO schema_migrations (name) VALUES ('sbt_legacy_simulated_v1')`);
      console.log('[Database Migration] sbt_legacy_simulated_v1 applied: pre-existing user_sbts rows conservatively labeled simulated (provenance unknown).');
    }

    // --- Schema Migration Queries ---
    // Ensure default integrity_score constraint and migrate any NULL values to 100
    await client.query(`ALTER TABLE users ALTER COLUMN integrity_score SET DEFAULT 100`);
    await client.query(`UPDATE users SET integrity_score = 100 WHERE integrity_score IS NULL`);

    // Ensure user_progress has notes column if table already exists
    await client.query(`ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS notes TEXT`);

    // --- Phase 4 Sprint 3 — Learning quality schema (features 6-10) ---

    // Feature 6 (Dashboard insight): persist per-attempt WPM for the WPM-over-time metric
    await client.query(`ALTER TABLE quiz_results ADD COLUMN IF NOT EXISTS wpm DOUBLE PRECISION`);

    // Feature 7 (Spaced repetition): SM-2 style schedule, one row per (user, material)
    await client.query(`
      CREATE TABLE IF NOT EXISTS spaced_repetition (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        material_slug VARCHAR(255) NOT NULL,
        ease_factor DOUBLE PRECISION NOT NULL DEFAULT 2.5,
        interval_days INTEGER NOT NULL DEFAULT 0,
        repetitions INTEGER NOT NULL DEFAULT 0,
        lapses INTEGER NOT NULL DEFAULT 0,
        last_reviewed TIMESTAMP,
        next_review_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_result VARCHAR(30),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, material_slug)
      )
    `);

    // Feature 8 (Pre/post-test diagnostic): tag which kind of test produced the row
    // Feature 8 (Pre/post-test diagnostic): tag attempts so submit writes the
    // right test_type into quiz_results.
    await client.query(`ALTER TABLE assessment_attempts ADD COLUMN IF NOT EXISTS test_type VARCHAR(20) DEFAULT 'assessment'`);
    await client.query(`ALTER TABLE quiz_results ADD COLUMN IF NOT EXISTS test_type VARCHAR(20) DEFAULT 'assessment'`);

    // Feature 9 (Essay rubric feedback): provenance for AI-assisted essay feedback
    await client.query(`
      CREATE TABLE IF NOT EXISTS essay_feedback (
        id SERIAL PRIMARY KEY,
        attempt_id UUID,
        score DOUBLE PRECISION,
        total_points INTEGER,
        strengths JSONB,
        weaknesses JSONB,
        recommendations JSONB,
        rubric JSONB,
        model VARCHAR(200),
        used_ai BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Feature 10 (Path versioning): explicit versions so curriculum edits never
    // silently rewrite a learner's existing progress.
    await client.query(`ALTER TABLE user_learning_paths ADD COLUMN IF NOT EXISTS version INT DEFAULT 1`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS learning_path_version INT DEFAULT 1`);
    await client.query(`ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS material_version INT DEFAULT 1`);

    // Phase 4 migration log (honest provenance for future deploys): write once
    const phase4Migration = await client.query(`SELECT 1 FROM schema_migrations WHERE name = 'phase4_sprint3_learning_quality_v1'`);
    if (phase4Migration.rows.length === 0) {
      await client.query(`INSERT INTO schema_migrations (name) VALUES ('phase4_sprint3_learning_quality_v1')`);
      console.log('[Database Migration] phase4_sprint3_learning_quality_v1 applied: dashboard/spaced-repetition/diagnostic/essay/versioning foundation.');
    }

    await client.query('COMMIT');
    console.log('[Database] Database tables initialized successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Database] Failed to initialize database tables:', error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  initializeDatabase,
};
