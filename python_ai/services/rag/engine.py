from google import genai
from google.genai import types
import os
import json
import re
import math
import requests
import google.generativeai as tgai
from typing import List, Optional
from dataclasses import dataclass, asdict, field
from pathlib import Path

from .vectorstore import VectorStore

# ── Config ────────────────────────────────────────────────────────────────────

CONFIG_PATH = Path(__file__).parent.parent.parent / "data" / "curriculum_config.json"
_config: dict = {}

def _load_config() -> dict:
    global _config
    if not _config:
        with open(CONFIG_PATH) as f:
            _config = json.load(f)
    return _config


# ── Dataclasses ───────────────────────────────────────────────────────────────

@dataclass
class Material:
    """Satu materi/topik dalam learning path."""
    id: str
    slug: str
    title: str
    role: str
    topic_type: str          # topic | subtopic
    priority: str            # core | advanced
    parent_topic: str
    content_summary: str     # ringkasan konten untuk ditampilkan ke user
    week_number: int         # materi ini dijadwalkan di minggu ke-berapa
    estimated_hours: float


@dataclass
class LearningPlan:
    """Full learning plan hasil generate untuk satu role + durasi."""
    role: str
    duration_months: int
    total_weeks: int
    hours_per_week: float
    total_materials: int
    core_materials: int
    advanced_materials: int
    weekly_schedule: List[dict]   # [{week: 1, materials: [Material, ...]}, ...]
    pace_note: str


@dataclass
class QuizQuestion:
    type: str                # multiple_choice | essay
    question: str
    options: Optional[List[str]] = None   # untuk multiple_choice
    correct_answer: Optional[str] = None  # index option (A/B/C/D) atau None untuk essay
    explanation: str = ""
    difficulty: str = "medium"


@dataclass
class LivecodeChallenge:
    title: str
    description: str
    starter_code: str
    expected_behavior: str
    hints: List[str]
    difficulty: str
    estimated_minutes: int


@dataclass
class VoiceChallenge:
    trigger_reason: str      # kenapa voice challenge dipicu
    question: str            # pertanyaan yang harus dijawab via suara
    context: str             # konteks dari tulisan/kode user
    expected_keywords: List[str]
    time_limit_seconds: int = 120


@dataclass
class FinalChallenge:
    livecode: LivecodeChallenge
    voice_explanation_prompt: str   # "Jelaskan kode yang kamu tulis..."
    expected_voice_keywords: List[str]


# ── Engine ────────────────────────────────────────────────────────────────────

class RAGEngine:
    LLM_MODEL = "gemini-1.5-flash"

    # Jam belajar per minggu berdasarkan durasi (bulan)
    HOURS_PER_WEEK = {1: 10, 2: 8, 3: 7, 4: 6, 6: 5}

    def __init__(self, vector_store: VectorStore, api_key: str):
        self.client = genai.Client(api_key=api_key)
        self.vs = vector_store
        self.cfg = _load_config()
        print(f"[RAGEngine] Ready — model: {self.LLM_MODEL}")

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _llm(self, prompt: str, json_mode: bool = True) -> str:
        # 1. Ambil API Key secara aman dari client atau fallback ke key kamu
        api_key = getattr(self.client, 'key', None)
        if not api_key:
            api_key = "AQ.Ab8RN6JBkn_NoC3Mb2WiW4xd6EjPW0KgF6GDS8bp1vTkElq5WA"
            
        # 2. Set URL endpoint resmi Google AI Studio (Gunakan v1 agar stabil dengan API Key)
        url = f"https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key={api_key}"
        
        headers = {
            "Content-Type": "application/json"
        }
        
        # 3. Susun payload sesuai dokumentasi resmi Google REST API
        payload = {
            "contents": [{
                "parts": [{"text": prompt}]
            }],
            "generationConfig": {
                "temperature": 0.4
            }
        }
        
        # Jika butuh JSON, paksa lewat config REST API
        if json_mode:
            payload["generationConfig"]["responseMimeType"] = "application/json"
            
        # 4. Tembak langsung menggunakan requests
        try:
            response = requests.post(url, headers=headers, json=payload)
            response_json = response.json()
            
            # Jika API mengembalikan error code (seperti 400, 401, dsb)
            if response.status_code != 200:
                raise Exception(f"Google API Error {response.status_code}: {response.text}")
                
            # Ambil output teks dari struktur response Gemini
            text_output = response_json['candidates'][0]['content']['parts'][0]['text']
            return text_output
            
        except Exception as e:
            print(f"❌ [REST API Error] Gagal berkomunikasi dengan Gemini: {e}")
            raise e

    def _clean_json(self, text: str) -> str:
        text = re.sub(r"```json\s*", "", text)
        text = re.sub(r"```\s*", "", text)
        return text.strip()

    def _get_core_slugs(self, role: str) -> set:
        """Slug dari core_topics + core_subtopics untuk role tertentu."""
        cfg = self.cfg.get(role, {})
        names = set(cfg.get("core_topics", [])) | set(cfg.get("core_subtopics", []))
        return names

    def _get_advanced_slugs(self, role: str) -> set:
        cfg = self.cfg.get(role, {})
        names = set(cfg.get("advanced_topics", [])) | set(cfg.get("advanced_subtopics", []))
        return names

    def _hours_per_week(self, duration_months: int) -> float:
        """Jam belajar per minggu — makin lama durasi, makin santai pace."""
        keys = sorted(self.HOURS_PER_WEEK.keys())
        for k in keys:
            if duration_months <= k:
                return self.HOURS_PER_WEEK[k]
        return self.HOURS_PER_WEEK[keys[-1]]

    def _retrieve_context(self, query: str, role: str, n: int = 5) -> str:
        docs = self.vs.query(query, n_results=n, domain_filter=role)
        return "\n\n---\n\n".join(
            f"[{d.get('topic_name', '')}]\n{d['text']}" for d in docs
        )

    # ── 1. Pace Calculator + Learning Plan ───────────────────────────────────

    def generate_learning_plan(
        self,
        role: str,
        duration_months: int,
    ) -> LearningPlan:
        """
        Buat jadwal belajar per minggu berdasarkan role dan durasi.
        Core materials wajib masuk. Advanced materials diisi kalau ada sisa slot.
        Setiap materi diasumsikan butuh ~2 jam (baca + quiz + livecode).
        """
        print(f"\n[RAGEngine] Generating learning plan: role={role}, duration={duration_months} bulan")

        # Load semua docs untuk role ini
        jsonl_path = Path(__file__).parent.parent.parent / "data" / "knowledge_base" / f"{role}.jsonl"
        if not jsonl_path.exists():
            raise FileNotFoundError(f"Knowledge base tidak ditemukan: {jsonl_path}")

        all_docs = [json.loads(l) for l in open(jsonl_path)]

        core_names   = self._get_core_slugs(role)
        adv_names    = self._get_advanced_slugs(role)

        # Klasifikasikan setiap dokumen
        core_docs, adv_docs, other_docs = [], [], []
        for d in all_docs:
            name = d["topic_name"]
            if name in core_names:
                core_docs.append(d)
            elif name in adv_names:
                adv_docs.append(d)
            else:
                other_docs.append(d)

        # Sort: topics dulu, lalu subtopics (berdasarkan position)
        def sort_key(d):
            return (0 if d["topic_type"] == "topic" else 1, d.get("position_in_roadmap", 999))

        core_docs.sort(key=sort_key)
        adv_docs.sort(key=sort_key)

        # Hitung kapasitas
        total_weeks      = duration_months * 4
        hours_per_week   = self._hours_per_week(duration_months)
        hours_per_material = 2.0          # estimasi per materi
        slots_per_week   = max(1, int(hours_per_week / hours_per_material))
        total_slots      = total_weeks * slots_per_week

        print(f"[RAGEngine] {total_weeks} minggu × {slots_per_week} materi/minggu = {total_slots} slot")
        print(f"[RAGEngine] Core: {len(core_docs)}, Advanced: {len(adv_docs)}, Other: {len(other_docs)}")

        # Pilih materi: core dulu, lalu advanced, lalu other kalau masih ada slot
        selected: List[dict] = []
        selected.extend(core_docs)
        remaining_slots = total_slots - len(core_docs)

        if remaining_slots > 0:
            selected.extend(adv_docs[:remaining_slots])
            remaining_slots -= len(adv_docs[:remaining_slots])

        if remaining_slots > 0:
            selected.extend(other_docs[:remaining_slots])

        # Buat Material objects
        materials: List[Material] = []
        for i, d in enumerate(selected):
            week_num = (i // slots_per_week) + 1
            week_num = min(week_num, total_weeks)

            name = d["topic_name"]
            priority = "core" if name in core_names else ("advanced" if name in adv_names else "supplementary")

            materials.append(Material(
                id=d["doc_id"],
                slug=d["slug"],
                title=d["topic_name"],
                role=role,
                topic_type=d["topic_type"],
                priority=priority,
                parent_topic=d.get("parent_topic", ""),
                content_summary=d["content"][:300].strip(),
                week_number=week_num,
                estimated_hours=hours_per_material,
            ))

        # Susun weekly schedule
        from collections import defaultdict
        week_map = defaultdict(list)
        for m in materials:
            week_map[m.week_number].append(asdict(m))

        weekly_schedule = [
            {"week": w, "materials": week_map[w]}
            for w in range(1, total_weeks + 1)
            if week_map[w]
        ]

        core_count = sum(1 for m in materials if m.priority == "core")
        adv_count  = sum(1 for m in materials if m.priority == "advanced")

        pace_msgs = {
            1: "Intensif — 10 jam/minggu. Fokus core dulu.",
            2: "Moderat — 8 jam/minggu. Seimbang antara core dan advanced.",
            3: "Santai — 6 jam/minggu. Ada ruang untuk eksplorasi lebih dalam.",
        }
        pace_note = pace_msgs.get(duration_months, f"{hours_per_week} jam/minggu, {total_weeks} minggu total.")

        plan = LearningPlan(
            role=role,
            duration_months=duration_months,
            total_weeks=total_weeks,
            hours_per_week=hours_per_week,
            total_materials=len(materials),
            core_materials=core_count,
            advanced_materials=adv_count,
            weekly_schedule=weekly_schedule,
            pace_note=pace_note,
        )

        print(f"[RAGEngine] ✓ Plan: {len(materials)} materi, {core_count} core, {adv_count} advanced")
        return plan

    # ── 2. Quiz Generator ─────────────────────────────────────────────────────

    def generate_quiz(
        self,
        material: dict,
        n_pg: int = 4,
        n_essay: int = 1,
    ) -> List[QuizQuestion]:
        """
        Generate soal quiz untuk satu materi.
        n_pg: jumlah soal pilihan ganda
        n_essay: jumlah soal essay
        """
        print(f"[RAGEngine] Generating quiz: {material['title']} ({n_pg} PG + {n_essay} essay)")

        context = self._retrieve_context(material["title"], material["role"], n=4)

        prompt = f"""Kamu adalah pembuat soal untuk platform pembelajaran VerifyLearn.

MATERI: {material['title']}
KONTEN:
{material.get('content_summary', '')}

KONTEKS TAMBAHAN:
{context[:1000]}

Buat soal quiz dengan format berikut:
- {n_pg} soal pilihan ganda (A/B/C/D), difficulty: easy hingga medium
- {n_essay} soal essay pendek, difficulty: medium

Respond HANYA JSON valid:
{{
  "questions": [
    {{
      "type": "multiple_choice",
      "question": "<pertanyaan>",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "correct_answer": "A",
      "explanation": "<penjelasan singkat kenapa jawaban ini benar>",
      "difficulty": "easy"
    }},
    {{
      "type": "essay",
      "question": "<pertanyaan essay>",
      "options": null,
      "correct_answer": null,
      "explanation": "<poin-poin yang harus ada dalam jawaban ideal>",
      "difficulty": "medium"
    }}
  ]
}}"""

        raw = self._llm(prompt)
        data = json.loads(self._clean_json(raw))

        return [
            QuizQuestion(
                type=q["type"],
                question=q["question"],
                options=q.get("options"),
                correct_answer=q.get("correct_answer"),
                explanation=q.get("explanation", ""),
                difficulty=q.get("difficulty", "medium"),
            )
            for q in data["questions"]
        ]

    # ── 3. Livecode Challenge ─────────────────────────────────────────────────

    def generate_livecode_challenge(
        self,
        material: dict,
        difficulty: str = "normal",
    ) -> LivecodeChallenge:
        """
        Generate tantangan coding untuk satu materi.
        difficulty: "normal" (user normal) | "hard" (user anomali)
        """
        print(f"[RAGEngine] Generating livecode: {material['title']} [{difficulty}]")

        context = self._retrieve_context(material["title"], material["role"], n=4)
        role = material["role"]

        lang_hint = {
            "backend":   "Go atau Python (sesuai materi)",
            "frontend":  "JavaScript atau TypeScript",
            "fullstack": "JavaScript/TypeScript (frontend) atau Node.js (backend)",
        }.get(role, "sesuai materi")

        difficulty_instruction = {
            "normal": "Soal cukup untuk membuktikan pemahaman dasar konsep.",
            "hard":   "Soal lebih kompleks, membutuhkan penerapan konsep secara mendalam dan tidak bisa diselesaikan hanya dengan copy-paste.",
        }.get(difficulty, "")

        prompt = f"""Kamu adalah pembuat tantangan coding untuk platform VerifyLearn.

MATERI: {material['title']}
BAHASA: {lang_hint}
LEVEL: {difficulty_instruction}

KONTEKS:
{context[:800]}

Buat 1 tantangan livecode yang:
1. Spesifik ke konsep materi ini
2. Bisa diselesaikan dalam {20 if difficulty == 'normal' else 35} menit
3. Starter code sudah tersedia (user tinggal melengkapi)

Respond HANYA JSON valid:
{{
  "title": "<judul singkat>",
  "description": "<deskripsi soal yang jelas, termasuk input/output yang diharapkan>",
  "starter_code": "<kode awal dengan TODO comments>",
  "expected_behavior": "<apa yang harus terjadi saat kode dijalankan>",
  "hints": ["<hint 1>", "<hint 2>"],
  "difficulty": "{difficulty}",
  "estimated_minutes": {20 if difficulty == 'normal' else 35}
}}"""

        raw = self._llm(prompt)
        data = json.loads(self._clean_json(raw))

        return LivecodeChallenge(
            title=data["title"],
            description=data["description"],
            starter_code=data["starter_code"],
            expected_behavior=data["expected_behavior"],
            hints=data.get("hints", []),
            difficulty=data["difficulty"],
            estimated_minutes=data["estimated_minutes"],
        )

    # ── 4. Voice Challenge (anomali dadakan) ──────────────────────────────────

    def generate_voice_challenge(
        self,
        material: dict,
        user_code_or_text: str,
        trigger_reason: str,
    ) -> VoiceChallenge:
        """
        Generate pertanyaan voice dadakan saat anomali terdeteksi.
        Pertanyaan harus spesifik ke kode/teks yang ditulis user.
        """
        print(f"[RAGEngine] Generating voice challenge — trigger: {trigger_reason}")

        prompt = f"""Kamu adalah interviewer teknikal VerifyLearn.
User terdeteksi anomali: {trigger_reason}

MATERI YANG SEDANG DIKERJAKAN: {material['title']}

KODE/TEKS USER:
\"\"\"
{user_code_or_text[:1200]}
\"\"\"

Buat 1 pertanyaan verifikasi suara yang:
1. Sangat spesifik ke kode/teks user (bukan pertanyaan generik)
2. Hanya bisa dijawab jika user benar-benar memahami apa yang ditulis
3. Tidak bisa dijawab dengan jawaban template

Respond HANYA JSON valid:
{{
  "question": "<pertanyaan yang harus dijawab user via suara>",
  "context": "<konteks singkat mengapa pertanyaan ini diajukan>",
  "expected_keywords": ["kw1", "kw2", "kw3"],
  "time_limit_seconds": 120
}}"""

        raw = self._llm(prompt)
        data = json.loads(self._clean_json(raw))

        return VoiceChallenge(
            trigger_reason=trigger_reason,
            question=data["question"],
            context=data.get("context", ""),
            expected_keywords=data["expected_keywords"],
            time_limit_seconds=data.get("time_limit_seconds", 120),
        )

    # ── 5. Final Challenge per Materi ─────────────────────────────────────────

    def generate_final_challenge(self, material: dict) -> FinalChallenge:
        """
        Final challenge untuk menutup satu materi.
        Terdiri dari livecode (lebih sulit) + voice explanation setelah selesai.
        """
        print(f"[RAGEngine] Generating final challenge: {material['title']}")

        livecode = self.generate_livecode_challenge(material, difficulty="hard")

        context = self._retrieve_context(material["title"], material["role"], n=3)
        prompt = f"""Buat prompt voice explanation untuk tantangan berikut:

MATERI: {material['title']}
TANTANGAN: {livecode.title}
DESKRIPSI: {livecode.description}

Buat kalimat instruksi yang meminta user menjelaskan kode yang baru ditulis via suara.
Prompt harus natural, seperti interviewer sungguhan yang meminta klarifikasi.

Respond HANYA JSON valid:
{{
  "voice_prompt": "<kalimat instruksi untuk user>",
  "expected_keywords": ["kw1", "kw2", "kw3", "kw4", "kw5"]
}}"""

        raw = self._llm(prompt)
        data = json.loads(self._clean_json(raw))

        return FinalChallenge(
            livecode=livecode,
            voice_explanation_prompt=data["voice_prompt"],
            expected_voice_keywords=data["expected_keywords"],
        )

    # ── Serialization helper ──────────────────────────────────────────────────

    def to_dict(self, obj) -> dict:
        return asdict(obj)