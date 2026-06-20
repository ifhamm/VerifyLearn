"""
services/semantic/analyzer.py
==============================
Modul analisis semantik untuk VerifyLearn.

Digunakan untuk:
- Membandingkan jawaban user dengan jawaban referensi secara semantik
  (bukan exact-match) menggunakan cosine similarity embedding.
- Mendeteksi plagiarisme atau jawaban yang terlalu mirip satu sama lain.
- Mengevaluasi apakah penjelasan suara user mencakup kata kunci yang diharapkan.

Integrasi dengan RAGEngine:
  Gunakan LocalEmbedder dari services.rag.embedder untuk embed teks,
  lalu bandingkan dengan cosine_similarity.
"""

from __future__ import annotations

import sys
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, BASE_DIR)

from services.rag.embedder import LocalEmbedder


class SemanticAnalyzer:
    """
    Analisis kemiripan semantik antara dua teks menggunakan embedding lokal.

    Contoh penggunaan::

        analyzer = SemanticAnalyzer()
        score = analyzer.similarity("REST menggunakan HTTP", "HTTP adalah protokol web")
        # score ~ 0.75 (cukup mirip secara makna)
    """

    # Threshold di atas ini dianggap "semantically similar"
    SIMILARITY_THRESHOLD = 0.75

    def __init__(self) -> None:
        self.embedder = LocalEmbedder()

    def similarity(self, text_a: str, text_b: str) -> float:
        """
        Hitung cosine similarity antara dua teks.
        Return nilai antara -1.0 hingga 1.0, semakin tinggi semakin mirip.
        """
        vec_a = self.embedder.embed_document(text_a)
        vec_b = self.embedder.embed_document(text_b)
        return self.embedder.cosine_similarity(vec_a, vec_b)

    def is_similar(self, text_a: str, text_b: str) -> bool:
        """Return True jika kedua teks dianggap semantically similar."""
        return self.similarity(text_a, text_b) >= self.SIMILARITY_THRESHOLD

    def contains_keywords(self, text: str, keywords: list[str], min_match: int = 2) -> bool:
        """
        Cek apakah teks mengandung setidaknya `min_match` kata kunci
        secara semantik (bukan exact-match string).

        Cocok untuk evaluasi jawaban voice challenge.
        """
        matched = 0
        for kw in keywords:
            if self.similarity(text, kw) >= 0.55:
                matched += 1
            if matched >= min_match:
                return True
        return False
