# AGENTS.md — AI Coding Agent Instructions for VerifyLearn Python AI

Purpose: panduan ringkas dan actionable bagi AI coding agent agar produktif di repository ini.

## Quick Start

```bash
pip install -r requirements.txt

# Ingest knowledge base ke ChromaDB (jalankan sekali):
python scripts/ingest_kb.py

# Atau build dari sumber roadmap.sh:
python scripts/build_knowledge_base.py --roadmap-dir /path/to/developer-roadmap/src/data/roadmaps

# Build bank soal dari roadmap question-groups:
python scripts/build_question_bank.py --question-dir /path/to/developer-roadmap/src/data/question-groups

# Jalankan server:
uvicorn server:app --host 0.0.0.0 --port 8000

# CLI demo/test lokal:
python main.py --role backend
```

## Struktur Folder

```
python_ai/
├── server.py               ← FastAPI entry point (Docker CMD)
├── main.py                 ← CLI test runner
├── requirements.txt
├── Dockerfile
├── .dockerignore
├── AGENTS.md
│
├── scripts/                ← Script builder & ingest (one-off tasks)
│   ├── build_knowledge_base.py
│   ├── build_question_bank.py
│   ├── enrich_knowledge_base.py
│   └── ingest_kb.py
│
├── services/               ← Modul AI utama
│   ├── rag/
│   │   ├── embedder.py     ← LocalEmbedder (sentence-transformers)
│   │   ├── vectorstore.py  ← ChromaDB wrapper
│   │   └── engine.py       ← RAGEngine (learning plan, quiz, livecode, voice)
│   ├── semantic/
│   │   └── analyzer.py     ← SemanticAnalyzer (kemiripan teks)
│   └── voice/
│       └── verifier.py     ← VoiceVerifier (evaluasi jawaban suara)
│
├── data/
│   ├── curriculum_config.json
│   ├── knowledge_base/     ← JSONL knowledge base per role
│   ├── question_bank/      ← JSONL bank soal per role
│   └── syllabi/
│
└── chroma_db/              ← ChromaDB persistence (jangan dihapus sembarangan)
```

## Key Files & Why to Inspect

| File | Fungsi |
|------|--------|
| `server.py` | FastAPI server — semua HTTP endpoint |
| `main.py` | CLI demo dan test pipeline RAGEngine |
| `services/rag/engine.py` | RAGEngine — learning plan, quiz, livecode, voice challenge |
| `services/rag/embedder.py` | `LocalEmbedder` — sentence-transformers lokal (all-MiniLM-L6-v2) |
| `services/rag/vectorstore.py` | ChromaDB wrapper — ingest, query, count |
| `services/semantic/analyzer.py` | `SemanticAnalyzer` — kemiripan semantik antar teks |
| `services/voice/verifier.py` | `VoiceVerifier` — evaluasi transkrip jawaban suara |
| `scripts/build_knowledge_base.py` | Ekstrak roadmap.sh → JSONL knowledge base |
| `scripts/build_question_bank.py` | Ekstrak roadmap question-groups → JSONL question bank |
| `scripts/ingest_kb.py` | Ingest JSONL knowledge base yang sudah ada ke ChromaDB |
| `scripts/enrich_knowledge_base.py` | Tambah ringkasan URL eksternal ke knowledge base |
| `data/curriculum_config.json` | Konfigurasi topik core/advanced per role |
| `data/knowledge_base/` | JSONL knowledge base per role (backend/frontend/fullstack) |
| `data/question_bank/` | JSONL bank soal per role |

## Conventions & Notes for Agents

- **Bahasa**: Komentar dan UX berbahasa Indonesia. Gunakan Indonesia untuk teks user-facing.
- **Local-first stack**: Embedding dengan `sentence-transformers` (lokal), LLM via Ollama/Qwen (lokal). Jangan tambah dependency cloud kecuali diminta.
- **Embedder**: Class bernama `LocalEmbedder` di `services/rag/embedder.py`. Alias `GeminiEmbedder` masih tersedia untuk backward-compatibility.
- **BASE_DIR di scripts/**: Semua script di `scripts/` menggunakan `BASE_DIR = dirname(dirname(__file__))` — menunjuk ke `python_ai/` root, bukan ke `scripts/`.
- **Persistence**: ChromaDB disimpan di `chroma_db/`. Hati-hati saat reset/wipe index.
- **JSON outputs**: Respons LLM harus valid JSON. Jaga agar generator tetap strict soal format JSON.
- **Collection ChromaDB**: `syllabi` (knowledge base roadmap) dan `question_bank` (bank soal interview) adalah dua collection terpisah.

## Alur Ingestion (Referensi)

```
roadmap.sh repo
    └─► scripts/build_knowledge_base.py  →  data/knowledge_base/*.jsonl
    └─► scripts/build_question_bank.py   →  data/question_bank/*_questions.jsonl
            ↓ (otomatis setelah extract)
        ChromaDB (chroma_db/)
            collection: syllabi        ← knowledge base
            collection: question_bank  ← bank soal
```

## Suggested Next Steps

- Implementasikan speech-to-text di `services/voice/` dan integrasikan `VoiceVerifier`
- Tambah endpoint `/api/verify-voice-answer` di `server.py` yang menggunakan `VoiceVerifier`
- Tambah endpoint `/api/semantic-similarity` untuk evaluasi jawaban essay
- Tambah `CONTRIBUTING.md` dengan langkah setup Python & Ollama model
