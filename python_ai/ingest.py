#!/usr/bin/env python3
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.rag.embedder import GeminiEmbedder
from services.rag.vectorstore import VectorStore

SYLLABI = [
    {"file": "data/syllabi/backend_go.txt", "domain": "backend"},
    {"file": "data/syllabi/data_engineering_python.txt", "domain": "data_engineering"},
    {"file": "data/syllabi/frontend_react.txt", "domain": "frontend"},
]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--db-dir", default="./chroma_db")
    args = parser.parse_args()

    embedder = GeminiEmbedder(api_key=args.api_key)
    vs = VectorStore(embedder=embedder, persist_dir=args.db_dir)

    base_dir = os.path.dirname(os.path.abspath(__file__))
    for syllabus in SYLLABI:
        fp = os.path.join(base_dir, syllabus["file"])
        if os.path.exists(fp):
            vs.ingest_file(fp, domain=syllabus["domain"])
        else:
            print(f"[SKIP] {fp} tidak ditemukan")

    print(f"\n✓ Total: {vs.count()} dokumen")

if __name__ == "__main__":
    main()