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

    // 3. Create user_learning_paths table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_learning_paths (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        role VARCHAR(100) NOT NULL,
        level VARCHAR(100) NOT NULL,
        duration_weeks INTEGER NOT NULL,
        commitment_hours DOUBLE PRECISION NOT NULL,
        plan_data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 4. Create user_progress table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        material_slug VARCHAR(255) NOT NULL,
        role VARCHAR(100) NOT NULL,
        status VARCHAR(50) DEFAULT 'in_progress',
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
