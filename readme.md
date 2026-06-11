# VerifyLearn Ecosystem 🎓🔐

VerifyLearn is a Web3 learning platform that utilizes AI-driven learning paths and verifies learning integrity through keystroke dynamics and anti-cheat voice challenges.

---

## 🏗️ System Architecture & Services

The ecosystem consists of two core services:

1. **Backend Service (`backend/`)**:
   - Built on Node.js & Express.
   - Serves the frontend user dashboard.
   - Manages user sessions, Web3 wallet auth, and API routes.
   - Dockerized and configured on port `3000`.

2. **Python AI Service (`python_ai/`)**:
   - Built on Python 3.10 with RAG (Retrieval-Augmented Generation) engine capabilities.
   - Integrates Gemini API (LLM) and ChromaDB (vector database) for roadmap indexing, quiz generation, and copy-paste detection anomaly scoring.
   - Dockerized and configured on port `8000`.

---

## 🐳 Running with Docker Compose

Ensure you have Docker and Docker Compose installed.

### 1. Configure Environment Variables
Create a `.env` file in the root directory (ignored by git):
```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### 2. Start the Entire Stack
Run the following command to build and run all services in the background:
```bash
docker-compose up --build -d
```

- **Backend Dashboard & API**: [http://localhost:3000](http://localhost:3000)
- **Python AI Service**: [http://localhost:8000](http://localhost:8000)

### 3. Stop the Stack
```bash
docker-compose down
```

---

## 🚀 CI/CD & Team Integration (GitHub Actions)

We have integrated a professional workflow located in `.github/workflows/docker.yml` that triggers on push/pull request to the `main` branch.

### Automated Container Publishing (GHCR)
On push to `main`, GitHub Actions will build, tag, and publish the production-ready images directly to the **GitHub Container Registry (GHCR)**.

To pull the latest pre-built images without building locally:
```bash
# Log in to GHCR (first time only)
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# Pull the latest backend image
docker pull ghcr.io/ifhamm/verifylearn-backend:latest

# Pull the latest AI service image
docker pull ghcr.io/ifhamm/verifylearn-python-ai:latest
```

---

## 📂 Repository Layout

```text
VerifyLearn/
├── .github/workflows/           # CI/CD pipelines
│   └── docker.yml               # Automated Docker build & push to GHCR
│
├── backend/                     # Node.js + Express Gateway and frontend client
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│
├── python_ai/                   # Python RAG & AI Engine
│   ├── Dockerfile
│   ├── requirements.txt
│   └── main.py
│
├── docker-compose.yml           # Orchestration for both services
└── README.md                    # This file
```
