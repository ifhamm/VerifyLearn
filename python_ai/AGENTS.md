# AGENTS.md — AI Coding Agent Instructions for VerifyLearn

Purpose: provide minimal, actionable guidance so AI coding agents (Copilot-style) can be productive in this repository.

Quick Start
- Install dependencies: `pip install -r requirements.txt`
- Build or ingest KB (optional): `python build_knowledge_base.py` or `python ingest.py`
- Run local demo: `python main.py --role backend`

Key Files & Why to Inspect
- `main.py`: CLI demo and typical run modes.
- `services/rag/engine.py`: core RAG orchestration (learning plan, quiz, livecode).
- `services/rag/embedder.py` and `services/rag/vectorstore.py`: embedding + ChromaDB handling.
- `data/curriculum_config.json` and `data/knowledge_base/`: role/topic configuration and source JSONL.

Conventions & Notes for Agents
- Language: project comments and UX are Indonesian; prefer Indonesian for user-facing text by default.
- Local-first stack: uses sentence-transformers (local embeddings) and Ollama/Qwen (local LLM). Avoid adding cloud-only dependencies unless requested.
- Persistence: Chroma DB stored under `chroma_db/` — be cautious when resetting or persisting indexes.
- JSON outputs: LLM responses are intended to be valid JSON. Keep generators strict about JSON format.

Suggested Small Customizations (next steps)
- Add `.github/copilot-instructions.md` if you prefer shorter workspace-scoped hints.
- Create a skill for `ingest` automation to run ingestion + sanity checks.
- Add a `CONTRIBUTING.md` with environment setup (Python version, Ollama model steps).

Where to look for more context
- Knowledge base extraction: `build_knowledge_base.py`
- RAG implementation: `services/rag/`
- Data and curricula: `data/`

If you want, I can now create `.github/copilot-instructions.md` or add a custom agent that automates ingestion and basic tests.
