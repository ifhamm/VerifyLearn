#!/usr/bin/env python3
"""
ingest_kb.py
============
Membaca file JSONL knowledge base yang sudah ada di repository,
membuat embeddings secara lokal, dan menyimpannya ke ChromaDB.

Cara Pakai:
  docker exec -it verify-learn-python-ai python ingest_kb.py
"""

import os
import sys
import json

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from services.rag.embedder import GeminiEmbedder
from services.rag.vectorstore import VectorStore

def main():
    print("============================================================")
    print("  VerifyLearn — Ingesting Existing JSONL Knowledge Base     ")
    print("  Embedding: sentence-transformers (all-MiniLM-L6-v2)       ")
    print("============================================================")
    
    db_dir = os.path.join(BASE_DIR, "chroma_db")
    kb_dir = os.path.join(BASE_DIR, "data", "knowledge_base")
    
    embedder = GeminiEmbedder()
    vs = VectorStore(embedder=embedder, persist_dir=db_dir)
    collection = vs.collection
    
    for role_key in ["backend", "frontend", "fullstack"]:
        jsonl_path = os.path.join(kb_dir, f"{role_key}.jsonl")
        if not os.path.exists(jsonl_path):
            print(f"  [SKIP] {jsonl_path} tidak ditemukan")
            continue
            
        print(f"\n🚀 Memproses role: {role_key} ({jsonl_path})...")
        docs = []
        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    docs.append(json.loads(line.strip()))
                    
        batch_size = 20  # Batch size lebih besar karena lokal tanpa rate-limit
        for i in range(0, len(docs), batch_size):
            batch = docs[i:i+batch_size]
            
            # Cek dokumen yang belum masuk untuk efisiensi
            new_batch = []
            for doc in batch:
                existing = collection.get(ids=[doc["doc_id"]])
                if not existing["ids"]:
                    new_batch.append(doc)
                    
            if not new_batch:
                continue
                
            print(f"  -> Batch {i//batch_size + 1}/{(len(docs)-1)//batch_size + 1} ({len(new_batch)} dokumen baru)...")
            embeddings = embedder.embed_documents_batch(
                [d["rag_text"] for d in new_batch],
                delay=0
            )
            
            collection.add(
                ids=[d["doc_id"] for d in new_batch],
                embeddings=embeddings,
                documents=[d["rag_text"] for d in new_batch],
                metadatas=[{
                    "role": d["role"],
                    "topic_name": d["topic_name"],
                    "topic_type": d["topic_type"],
                    "parent_topic": d["parent_topic"],
                    "slug": d["slug"],
                    "position": d["position_in_roadmap"],
                } for d in new_batch],
            )
            
    print(f"\n✓ Selesai! Total dokumen di database ChromaDB: {vs.count()}")

if __name__ == "__main__":
    main()
