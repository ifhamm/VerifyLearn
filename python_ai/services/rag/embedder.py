from sentence_transformers import SentenceTransformer
from typing import List
import numpy as np


class GeminiEmbedder:
    """
    Drop-in replacement menggunakan sentence-transformers lokal.
    Model 'all-MiniLM-L6-v2' ringan (80MB), cukup akurat untuk RAG,
    dan tidak butuh API key apapun.
    """

    DIMENSION = 384
    MODEL_NAME = "all-MiniLM-L6-v2"

    def __init__(self, api_key: str = ""):
        # api_key diabaikan — kept for interface compatibility
        print(f"[Embedder] Loading model '{self.MODEL_NAME}' (download ~80MB sekali)...")
        self.model = SentenceTransformer(self.MODEL_NAME)
        print(f"[Embedder] Model ready.")

    def embed_document(self, text: str) -> List[float]:
        return self.model.encode(text, normalize_embeddings=True).tolist()

    def embed_query(self, text: str) -> List[float]:
        return self.model.encode(text, normalize_embeddings=True).tolist()

    def embed_documents_batch(self, texts: List[str], delay: float = 0) -> List[List[float]]:
        print(f"  Embedding {len(texts)} dokumen sekaligus...")
        embeddings = self.model.encode(texts, normalize_embeddings=True, show_progress_bar=True)
        return embeddings.tolist()

    def cosine_similarity(self, vec_a: List[float], vec_b: List[float]) -> float:
        a, b = np.array(vec_a), np.array(vec_b)
        norm = np.linalg.norm(a) * np.linalg.norm(b)
        return float(np.dot(a, b) / norm) if norm > 0 else 0.0