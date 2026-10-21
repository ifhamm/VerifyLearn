# VerifyLearn Ecosystem 🎓🔐
> **AI-Powered Adaptive Learning & Web3 Behavioral Integrity Verification**

---

## 🏆 Introduction & Pitch

In the era of remote education, online credentials face a massive trust deficit. Traditional certificates are easily forged, assessments are vulnerable to copy-paste plagiarism (e.g., ChatGPT-aided cheating), and learning platforms lack verifiable proof of authentic learning.

**VerifyLearn** solves this by building a trustless, automated validation loop. By combining **AI-driven adaptive learning paths**, **Behavioral Biometrics (keystroke dynamics)**, and **Web3 Soulbound Tokens (SBT)**, VerifyLearn validates not just *what* was submitted, but *how* the learner completed the assessment. It is the ultimate platform for proving genuine skill acquisition.

---

## ✨ Key Winning Features

### 🧠 1. AI-Powered Adaptive Curriculum
- **Custom Learning Roadmap**: Generates weekly schedules dynamically tailored to the user's role (Frontend, Backend, Fullstack), skill level (Beginner to Advanced), and daily commitment.
- **RAG-Composed Assessments**: Utilizes Retrieval-Augmented Generation (RAG) to generate quizzes and evaluations based on real, indexed course content.

### ⌨️ 2. Behavioral Biometrics (Keystroke Dynamics)
- **Typing Cadence Fingerprinting**: Measures typing rhythm (dwell time and flight time) down to the millisecond during writing assessments.
- **Plagiarism & Anti-Cheat Engine**: Compares the user's live typing fingerprint against their established pattern to verify identity and detect copy-paste or AI-generated injections.

### 🎙️ 3. Multi-Modal Anti-Cheat Voice Challenges
- **Voice Biometrics Verification**: Integrates audio recording challenges during milestone assessments to confirm the learner's identity biometrically.

### 🔀 4. Multi-Path Switcher & Concurrent Progress
- **Flexible Lifelong Learning**: Allows users to simultaneously enroll in and maintain progress for Frontend, Backend, and Fullstack paths.
- **Independent State Persistence**: Tracks progress, custom roadmap unlocks, and quiz scores independently per path without losing historical data.

### ⛓️ 5. Immutable Web3 Credentials (Soulbound Tokens)
- **Soulbound Tokens (SBT)**: Automatically mints non-transferable, on-chain badges for completing modules and final paths.
- **Trustless CV**: Credentials are permanently bound to the user's wallet address, serving as a tamper-proof digital resume.

### 📦 6. Credential Share Pack (Public Verification)
- **Shareable verification page** at `/verify/c/<credential-id>`: a print-ready certificate showing the achievement, the server-graded score, the holder, and a live provenance badge.
- **Server-rendered QR code** (`/api/v1/credentials/<id>/qr.png`) so the page works with no client JS and prints cleanly on physical certificates.
- **W3C-style Verifiable Credential export** (`/api/v1/credentials/<id>/vc`) — a machine-readable credential signed by the issuer with an EIP-191 signature, plus explicit provenance so a simulated or revoked credential can never masquerade as a valid on-chain one.
- **Revocation**: admins (an `ADMIN_WALLETS` allowlist) can revoke a credential on-chain and in the record. Revoked credentials stay resolvable — an old link or a screenshot cannot be made to look valid.
- **Honest lifecycle**: a mint that is broadcast but not yet confirmed is reported as `submitted` (HTTP 202), never as a fake success; a background watcher resolves it from the chain.

---

## 🏗️ System Architecture

VerifyLearn is composed of three decoupled, high-performance layers:

```text
                     ┌──────────────────────────┐
                     │    Frontend Dashboard    │
                     │  (HTML, Tailwind, JS)    │
                     └────────────┬─────────────┘
                                  │ HTTPS / WebSockets
                                  ▼
                     ┌──────────────────────────┐
                     │  Express.js API Gateway  │ <───> [ PostgreSQL ]
                     │  (Web3 Auth, Notes API)  │
                     └────────────┬─────────────┘
                                  │ Local HTTP
                                  ▼
 ┌──────────────────────────────────────────────────────────────┐
 │                    Python AI Service                         │
 │  - RAG Engine Orchestrator      - Sentence-Transformers      │
 │  - Local Chroma Vector DB       - Local Voice verification   │
 └──────────────────────────────┬───────────────────────────────┘
                                │ Ollama API (11434)
                                ▼
                   ┌──────────────────────────┐
                   │    Local Qwen 2.5 LLM    │
                   │  (Or Cloud Gemini fallback)│
                   └──────────────────────────┘
```

1. **Backend Gateway Service (`backend/`)**:
   - Manages Web3 MetaMask/simulated wallet logins and session states.
   - Syncs active learning paths, progress markers, and keystroke records to a PostgreSQL database.
   - Triggers smart contract interactions on the blockchain to mint SBT badges.

2. **Python AI Engine (`python_ai/`)**:
   - Houses the Retrieval-Augmented Generation (RAG) stack.
   - Performs local embeddings (`sentence-transformers/all-MiniLM-L6-v2`) and persists data in a local Chroma DB.
   - Handles essay evaluation, voice challenge verification, and keystroke dynamics anomaly detection.

3. **Smart Contracts (`backend/contracts/`)**:
   - ERC-5114 equivalent Soulbound Token contract (`VerifyLearnSBT.sol`) deployed to secure achievements permanently.

---

## 🐳 Getting Started (Docker Compose)

The entire ecosystem is containerized for seamless, single-command local deployments.

### 1. Configure the Environment
Create a `.env` file in the root directory (ignored by git):
```env
# Optional: Set a Gemini key to run without local GPU resources
GEMINI_API_KEY=your_gemini_api_key_here

# Security: set APP_ENV=production for real deployments.
# Simulated (mock) wallet logins are disabled in production unless
# ALLOW_MOCK_LOGIN=true is set explicitly (never recommended).
APP_ENV=development
ALLOW_MOCK_LOGIN=true

# Blockchain credential minting.
# BLOCKCHAIN_MODE=real|simulated (omit to auto-resolve: production is always
# "real"; development is "real" only when all three values below are set,
# otherwise "simulated").
# - real: mints actually hit the configured chain. If configuration is
#   missing or the transaction fails, the mint FAILS (HTTP 502) — no fake
#   transaction hash is ever recorded.
# - simulated: dev-only credentials, clearly flagged in the UI and API.
BLOCKCHAIN_MODE=
RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
SYSTEM_PRIVATE_KEY=
SBT_CONTRACT_ADDRESS=
# Explorer links shown for real transactions (default: Sepolia Etherscan)
EXPLORER_URL=https://sepolia.etherscan.io
# ADMIN_WALLETS: comma-separated wallets allowed to revoke credentials.
# FAIL-CLOSED — if unset/empty, NOBODY is an admin and every revoke request
# gets a 403. Revocation is terminal (no un-revoke), so keep this list tight.
ADMIN_WALLETS=
# BASE_URL: public origin used in shared credential links and QR codes
# (defaults to the request host). Set it behind a proxy/CDN.
BASE_URL=

# Mint watcher: resolves mint transactions that were broadcast but not yet
# confirmed when the request returned (status 'submitted'). It polls receipts
# and, for records whose hash was lost in a crash, reconciles against the
# contract — see backend/src/services/mintWatcher.js.
# MINT_WATCHER_DISABLED=true turns it off (tests/local debugging only).
MINT_WATCHER_INTERVAL_MS=30000
MINT_PENDING_TIMEOUT_MS=600000
MINT_SUBMITTED_TIMEOUT_MS=900000
# How long to wait for a mint confirmation before handing off to the watcher
# (the API then answers 202 with status 'submitted' instead of failing).
MINT_WAIT_TIMEOUT_MS=45000

# Production hardening (backend)
# TRUST_PROXY: number of reverse-proxy hops in front of the backend (usually 1).
# Required for rate limiting to key on the real client IP. Leave unset locally.
TRUST_PROXY=
# CORS_ORIGIN: comma-separated allowed origins. Unset = open (development).
CORS_ORIGIN=
# AI_TIMEOUT_MS: fail-fast timeout for calls to the Python AI service (default 30000).
AI_TIMEOUT_MS=30000
# RATE_LIMIT_DISABLED: true disables all rate limiting — tests/local debug ONLY.
```

### 2. Launch the Services
Run the following command to build and launch the database, backend dashboard, and Python AI service:
```bash
docker-compose up --build -d
```

- **User Dashboard & Main App**: [http://localhost:3000](http://localhost:3000)
- **AI Core Microservice**: [http://localhost:8000](http://localhost:8000)

### 3. Populate Chroma Vector Database
Initialize the localized knowledge base inside the running Python AI container:
```bash
docker exec -it verify-learn-python-ai bash
python ingest_kb.py
```
*(This builds local text embeddings for syllabus topics and loads them into Chroma DB)*

---

## 🛠️ Local vs. Cloud AI Orchestration

To support both resource-constrained client machines and dedicated servers, VerifyLearn supports dual AI hosting modes:

### Mode A: Shared Local LLM (Host-Client Model)
Perfect for teams where only one developer runs the heavy model resources locally.
- **AI Host Machine**: Installs [Ollama](https://ollama.com), pulls `qwen2.5:latest`, sets `OLLAMA_HOST=0.0.0.0`, and shares their local IP address.
- **Client Developers**: Simply add the AI Host's IP to their `.env`:
  ```env
  OLLAMA_HOST=http://192.168.1.5:11434
  ```

### Mode B: Cloud API Fallback
If local GPU resources are unavailable, add your Gemini API Key to `.env`:
```env
GEMINI_API_KEY=AIzaSy...
```
The AI Service will automatically detect this key and redirect embedding and generation requests to the Google Gemini cloud API.

---

## 🔗 Deploying the SBT contract (Sepolia) — one-time setup

Real credential minting and revocation need `VerifyLearnSBT` deployed once.
**You do this yourself — the agent never touches private keys or networks.**

1. In the root `.env`, set a funded deployer wallet:
   ```env
   RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
   SYSTEM_PRIVATE_KEY=0x...        # deployer key — secret, never commit
   ```
   Fund the wallet from a Sepolia faucet (search "Sepolia faucet" — Alchemy,
   Infura and others give it away for free).
2. Compile + deploy (solc runs locally, installed as a dev dependency):
   ```bash
   cd backend
   npm ci
   node scripts/deploy.js
   ```
   The script prints the new contract address + explorer link, **writes
   `SBT_CONTRACT_ADDRESS` into the root `.env` automatically** (a public value
   — keys are never written or printed), and aborts with clear messages on
   missing config or zero balance. Faucets:
   [chain.link](https://faucets.chain.link/sepolia) ·
   [pk910](https://sepolia-faucet.pk910.de/).
3. Add the admin list and restart:
   ```env
   ADMIN_WALLETS=0xYourWallet      # who may revoke credentials (comma-separated)
   BLOCKCHAIN_MODE=real            # optional in dev; production is real by default
   ```
   ```bash
   docker restart verify-learn-backend   # or re-run npm run dev
   ```
4. Alternative: open [Remix IDE](https://remix.ethereum.org), paste
   `backend/contracts/VerifyLearnSBT.sol`, compile (0.8.x), deploy with the
   same wallet — then use the printed address as above.

Contract v2 adds **revocation**: `revoke(tokenId, reason)` (owner-only) and
`revoked(tokenId)` for verifiers. Revoked tokens stay queryable for audit, and
a revoked (user, module) pair can never be re-minted.

## 📦 Credential Share Pack — API & revocation

Once a credential is confirmed it gets an unguessable `credential_id` (UUID).
That id powers the public share page and the machine-readable exports:

| Endpoint | Purpose |
| --- | --- |
| `GET /verify/c/:credentialId` | Human-facing, print-ready verification page |
| `GET /api/v1/credentials/:credentialId` | Structured detail (holder, score, provenance, live on-chain check) |
| `GET /api/v1/credentials/:credentialId/vc` | W3C-style Verifiable Credential JSON with an EIP-191 issuer signature |
| `GET /api/v1/credentials/:credentialId/qr.png` | Server-rendered QR of the verify URL |
| `POST /api/v1/admin/sbt/:credentialId/revoke` | Revoke (requires `walletAuth` + an `ADMIN_WALLETS` wallet) |

**Revoking a credential** (issuance error, later-found fraud, retired
curriculum):

```bash
curl -X POST https://your-host/api/v1/admin/sbt/<credentialId>/revoke \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"reason":"issued to the wrong account"}'
```

In real mode the on-chain `revoke` runs **first** — if it fails the request
answers `502` and the record is left untouched (never a half-revoked state, and
never a `200` for a revoke that did not happen). Revocation is **terminal**:
there is no un-revoke, and the DB will never claim a revoked credential is
active.

**Honest lifecycle** — a mint that is broadcast but not yet confirmed returns
`202` with `status: "submitted"` (never a fake success). The mint watcher
resolves it from the chain; if the process died between broadcast and hash
write, it reconciles through the contract's `hasMinted` and either recovers the
credential (with no invented hash) or marks it failed so the user can retry.

## 🚀 Automated CI/CD (GitHub Actions)

### `.github/workflows/ci-cd.yml` — test & publish

On every **pull request** to `main` and every **push** to `main`, GitHub Actions runs:

1. `npm run check` — `node --check` syntax gate over all backend JS.
2. `npm run test:smoke` — four suites with no external dependencies (stubbed DB/AI):
   auth (12 checks), server-side assessment (105), blockchain lifecycle (44), app boot (5).
3. `npm run build:css` — Tailwind production build.
4. Docker image builds for both services (no push — build validation only).

On **push to `main` only** (after tests pass), it additionally publishes both images to
the **GitHub Container Registry (GHCR)**, tagged with the commit SHA and `latest`:

- `ghcr.io/ifhamm/verifylearn-backend:<sha>`
- `ghcr.io/ifhamm/verifylearn-python-ai:<sha>`

### `.github/workflows/deploy.yml` — manual production deploy

Deployment is **manual only** (`workflow_dispatch`) — pushes never touch production.
The workflow takes an `image_tag` (the commit SHA to deploy), SSHes into the server,
runs `docker compose -f docker-compose.prod.yml pull && up -d`, then health-checks
`/api/v1/status` and `/health`.

**One-time setup:**

1. On the VPS:
   ```bash
   sudo mkdir -p /opt/verifylearn && cd /opt/verifylearn
   # place docker-compose.prod.yml and .env here (see env section above)
   echo "<GHCR PAT with read:packages>" | docker login ghcr.io -u <user> --password-stdin
   ```
2. On GitHub: **Settings → Environments → create `production`**, add secrets
   `PROD_HOST`, `PROD_USER`, `PROD_SSH_KEY`. Optionally restrict it to `main` only.
3. On GitHub: **Settings → Actions → General → Workflow permissions** → allow
   GitHub Actions to create and approve pull requests / keep read-write so
   `GITHUB_TOKEN` can push packages (publish job requests `packages: write`).

**Deploy & rollback:** every SHA-tagged image is immutable, so rollback is just a
re-dispatch of the same workflow with the previous SHA as `image_tag`.

> Status: workflows are YAML-validated and ready, but no VPS/secrets exist yet —
> the first real CI run happens on the next push, and deployment activates once
> the setup above is completed.
