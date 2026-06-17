# AGENTS.md — Workspace AI Coding Agent Instructions for VerifyLearn

Purpose: provide concise, repository-level guidance so AI coding agents can be productive across both the backend service and Python AI service.

## What this repo contains
- `backend/`: Node.js + Express API gateway, frontend assets, keystroke/typing analytics, wallet auth, and service integration.
- `python_ai/`: Python RAG/AI engine with local embeddings, optional Ollama/Qwen support, and knowledge base ingestion.
- `docker-compose.yml`: orchestrates the backend and Python AI containers together.
- `.github/workflows/docker.yml`: GitHub Actions pipeline to build and push Docker images for `main`.

## Recommended agent priorities
- Use `docker-compose up --build -d` to run the full stack locally.
- For backend-only changes, inspect `backend/README.md` and `backend/src/`.
- For Python AI changes, inspect `python_ai/AGENTS.md`, `python_ai/main.py`, and `python_ai/services/`.
- Preserve existing docs and link to them rather than duplicating full setup instructions.

## Key files and areas
- `backend/src/app.js`: backend entrypoint and Express configuration.
- `backend/src/controllers/`: learning path and integrity/verification endpoints.
- `backend/src/services/aiService.js`: forwards AI requests to the Python AI engine.
- `backend/src/middlewares/walletAuth.js`: Web3 wallet authentication logic.
- `backend/public/js/keystroke.js`: keystroke dynamics capture and client-side metrics.
- `python_ai/main.py`: CLI/demo runner and common execution modes.
- `python_ai/services/rag/`: RAG orchestration, embedding, and vector store handling.
- `python_ai/data/`: curriculum config, knowledge base JSONL, and syllabi data.

## Agent-specific conventions
- Language: project UX comments and docs are Indonesian; prefer Indonesian for user-facing text changes unless the task specifically requests English.
- Local-first AI: `python_ai` is designed for local embeddings and local LLM usage via Ollama. Avoid introducing cloud-only dependencies unless explicitly requested.
- Chroma DB persistence: `python_ai/chroma_db/` stores the local vector database. Do not delete or reset it without explicit user instruction.
- JSON output expectation: `python_ai` components expect strict JSON-formatted responses when generating structured output.
- Avoid breaking the docker-compose service contract: `backend` expects Python AI at `http://python_ai:8000` inside Docker and the root compose uses `host.docker.internal` for Ollama host access.

## Useful docs to reference
- `readme.md` — repo overview and Docker Compose usage.
- `backend/README.md` — backend setup and local development.
- `python_ai/AGENTS.md` — Python AI-specific agent guidance.
- `.github/workflows/docker.yml` — CI/CD container build and publish pipeline.

## Suggested follow-up customization
- Add a workspace `.github/copilot-instructions.md` for shorter Copilot-specific hints.
- Add a custom skill for `python_ai` ingestion and local validation commands.
