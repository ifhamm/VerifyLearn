"""
services/voice/verifier.py
===========================
Modul verifikasi jawaban suara untuk anti-cheat VerifyLearn.

Digunakan untuk:
- Mengevaluasi transkrip jawaban suara user terhadap kata kunci yang diharapkan
  setelah voice challenge dipicu (misalnya karena copy-paste terdeteksi).
- Memberi skor seberapa baik user memahami kode/konten yang ditulis.
- Menggabungkan exact-match dan semantic-match untuk evaluasi yang lebih adil.

Alur kerja:
  1. RAGEngine.generate_voice_challenge() → VoiceChallenge (pertanyaan + expected_keywords)
  2. User menjawab via suara → speech-to-text → transcript string
  3. VoiceVerifier.verify(transcript, expected_keywords) → VoiceVerifyResult
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List
import re


@dataclass
class VoiceVerifyResult:
    """Hasil evaluasi jawaban suara user."""
    passed: bool              # True jika jawaban dianggap cukup
    score: float              # 0.0 – 1.0
    matched_keywords: List[str]
    missing_keywords: List[str]
    feedback: str


class VoiceVerifier:
    """
    Evaluasi transkrip jawaban suara terhadap kata kunci yang diharapkan.

    Contoh penggunaan::

        verifier = VoiceVerifier()
        result = verifier.verify(
            transcript="Fungsi ini menggunakan cache untuk menyimpan data sementara",
            expected_keywords=["cache", "menyimpan", "data", "sementara"],
            min_match_ratio=0.6,
        )
        print(result.passed, result.score)
    """

    def __init__(self, use_semantic: bool = False) -> None:
        """
        Args:
            use_semantic: Jika True, gunakan semantic similarity (butuh LocalEmbedder).
                          Jika False, gunakan exact/substring match saja (lebih cepat).
        """
        self.use_semantic = use_semantic
        self._analyzer = None
        if use_semantic:
            # Import lazy agar tidak selalu load model saat tidak diperlukan
            from services.semantic.analyzer import SemanticAnalyzer
            self._analyzer = SemanticAnalyzer()

    def _keyword_found(self, transcript: str, keyword: str) -> bool:
        """Cek apakah keyword ditemukan di transkrip (exact atau semantic)."""
        transcript_lower = transcript.lower()
        keyword_lower = keyword.lower()

        # Exact/substring match dulu (lebih cepat)
        if keyword_lower in transcript_lower:
            return True

        # Semantic match (opsional, lebih akurat tapi lebih lambat)
        if self.use_semantic and self._analyzer:
            return self._analyzer.similarity(transcript, keyword) >= 0.55

        return False

    def verify(
        self,
        transcript: str,
        expected_keywords: List[str],
        min_match_ratio: float = 0.6,
    ) -> VoiceVerifyResult:
        """
        Evaluasi jawaban suara.

        Args:
            transcript: Hasil speech-to-text dari jawaban user.
            expected_keywords: Daftar kata kunci yang diharapkan ada di jawaban.
            min_match_ratio: Minimal rasio kata kunci yang harus ditemukan (default 60%).

        Returns:
            VoiceVerifyResult dengan detail evaluasi.
        """
        if not transcript or not transcript.strip():
            return VoiceVerifyResult(
                passed=False,
                score=0.0,
                matched_keywords=[],
                missing_keywords=list(expected_keywords),
                feedback="No answer detected.",
            )

        matched = []
        missing = []
        for kw in expected_keywords:
            if self._keyword_found(transcript, kw):
                matched.append(kw)
            else:
                missing.append(kw)

        total = len(expected_keywords)
        score = len(matched) / total if total > 0 else 0.0
        passed = score >= min_match_ratio

        if passed:
            feedback = f"Answer accepted. {len(matched)}/{total} important concepts mentioned."
        else:
            feedback = (
                f"Answer incomplete. {len(matched)}/{total} concepts mentioned. "
                f"Missing concepts: {', '.join(missing)}."
            )

        return VoiceVerifyResult(
            passed=passed,
            score=round(score, 3),
            matched_keywords=matched,
            missing_keywords=missing,
            feedback=feedback,
        )
