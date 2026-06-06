import chromadb
from chromadb.config import Settings
from typing import List, Dict, Any, Optional
import hashlib
import re

from .embedder import GeminiEmbedder


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    """
    Split teks panjang menjadi chunks yang overlap.
    Overlap penting agar konteks tidak terpotong di tengah kalimat.
    """
    # Split per baris dulu, lalu gabung sampai chunk_size
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    chunks = []
    current_chunk_lines = []
    current_len = 0

    for line in lines:
        line_len = len(line)
        if current_len + line_len > chunk_size and current_chunk_lines:
            chunks.append("\n".join(current_chunk_lines))
            # Overlap: ambil N karakter terakhir sebagai awal chunk berikutnya
            overlap_text = " ".join(current_chunk_lines)[-overlap:]
            current_chunk_lines = [overlap_text] if overlap_text else []
            current_len = len(overlap_text)
        current_chunk_lines.append(line)
        current_len += line_len

    if current_chunk_lines:
        chunks.append("\n".join(current_chunk_lines))

    return chunks


def make_chunk_id(source: str, chunk_index: int) -> str:
    """Buat ID unik untuk tiap chunk berdasarkan source + index."""
    raw = f"{source}::chunk_{chunk_index}"
    return hashlib.md5(raw.encode()).hexdigest()


class VectorStore:
    """
    ChromaDB wrapper untuk VerifyLearn RAG.
    Collection 'syllabi' menyimpan semua materi silabus industri.
    Metadata yang disimpan: source, domain, difficulty, chunk_index
    """

    COLLECTION_NAME = "syllabi"

    def __init__(self, embedder: GeminiEmbedder, persist_dir: str = "./chroma_db"):
        self.embedder = embedder
        self.client = chromadb.PersistentClient(
            path=persist_dir,
            settings=Settings(anonymized_telemetry=False),
        )
        # cosine distance lebih baik untuk semantic similarity teks
        self.collection = self.client.get_or_create_collection(
            name=self.COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )
        print(f"[VectorStore] Collection '{self.COLLECTION_NAME}' siap. "
              f"Total dokumen tersimpan: {self.collection.count()}")

    def ingest_file(self, file_path: str, domain: str, chunk_size: int = 500):
        """
        Baca file teks, chunk, embed, dan simpan ke ChromaDB.
        domain contoh: 'backend_go', 'data_engineering', 'frontend_react'
        """
        with open(file_path, "r", encoding="utf-8") as f:
            raw_text = f.read()

        chunks = chunk_text(raw_text, chunk_size=chunk_size)
        print(f"[Ingest] {file_path} → {len(chunks)} chunks")

        ids, embeddings, documents, metadatas = [], [], [], []

        for i, chunk in enumerate(chunks):
            chunk_id = make_chunk_id(file_path, i)

            # Skip jika ID sudah ada (idempotent re-ingest)
            existing = self.collection.get(ids=[chunk_id])
            if existing["ids"]:
                print(f"  Skip chunk {i} (sudah ada)")
                continue

            ids.append(chunk_id)
            documents.append(chunk)
            metadatas.append({
                "source": file_path,
                "domain": domain,
                "chunk_index": i,
                "total_chunks": len(chunks),
            })

        if not ids:
            print(f"[Ingest] Semua chunk sudah ada, skip.")
            return

        print(f"[Ingest] Embedding {len(ids)} chunk baru...")
        embeddings = self.embedder.embed_documents_batch(documents)

        self.collection.add(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas,
        )
        print(f"[Ingest] ✓ {len(ids)} chunk berhasil disimpan.")

    def query(
        self,
        query_text: str,
        n_results: int = 5,
        domain_filter: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Cari dokumen paling relevan berdasarkan query.
        domain_filter bisa berisi nilai dari field 'domain' (ingest_file)
        atau field 'role' (ingest dari knowledge base builder).
        Return list of dicts: {text, source, domain, score}
        """
        query_embedding = self.embedder.embed_query(query_text)

        # Coba filter dengan 'role' (knowledge base baru), fallback ke 'domain' (silabus lama)
        where_clause = None
        if domain_filter:
            where_clause = {"$or": [
                {"role": {"$eq": domain_filter}},
                {"domain": {"$eq": domain_filter}},
            ]}

        total = self.collection.count()
        if total == 0:
            return []

        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=min(n_results, total),
            where=where_clause,
            include=["documents", "metadatas", "distances"],
        )

        output = []
        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        ):
            output.append({
                "text": doc,
                "source": meta.get("source", meta.get("slug", "")),
                "domain": meta.get("role", meta.get("domain", "")),
                "topic_name": meta.get("topic_name", ""),
                "similarity_score": round(1 - dist, 4),
            })

        return output

    def count(self) -> int:
        return self.collection.count()