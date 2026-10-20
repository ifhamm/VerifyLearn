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
