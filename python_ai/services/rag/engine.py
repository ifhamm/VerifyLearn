# pyrefly: ignore [missing-import]
import ollama
import json
import re
import math
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
    id: str
    slug: str
    title: str
    role: str
    topic_type: str
    priority: str            # core | advanced | supplementary
    parent_topic: str
    content_summary: str
    week_number: int
    estimated_hours: float


@dataclass
class LearningPlan:
    role: str
    duration_months: int
    total_weeks: int
    hours_per_week: float
    total_materials: int
    core_materials: int
    advanced_materials: int
    weekly_schedule: List[dict]
    pace_note: str


@dataclass
class QuizQuestion:
    type: str                # multiple_choice | essay
    question: str
    options: Optional[List[str]] = None
    correct_answer: Optional[str] = None
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
    trigger_reason: str
    question: str
    context: str
    expected_keywords: List[str]
    time_limit_seconds: int = 120


@dataclass
class FinalChallenge:
    livecode: LivecodeChallenge
    voice_explanation_prompt: str
    expected_voice_keywords: List[str]


# ── Engine ────────────────────────────────────────────────────────────────────

class RAGEngine:
    LLM_MODEL = "qwen2.5:latest"  # nama model lokal di Ollama

    HOURS_PER_WEEK = {1: 10, 2: 8, 3: 7, 4: 6, 6: 5}

    def __init__(self, vector_store: VectorStore, api_key: str = "", host: str = "http://localhost:11434"):
        import os
        # api_key diabaikan — Ollama berjalan lokal tanpa autentikasi
        env_host = os.getenv("OLLAMA_HOST")
        if env_host:
            host = env_host
        self.client = ollama.Client(host=host)
        self.vs = vector_store
        self.cfg = _load_config()
        print(f"[RAGEngine] Ready — model: {self.LLM_MODEL} (Ollama @ {host})")

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _llm(self, prompt: str) -> str:
        """Call Qwen2.5 via Ollama lokal, selalu return JSON string."""
        response = self.client.chat(
            model=self.LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "Kamu adalah AI assistant untuk platform pembelajaran VerifyLearn. "
                               "Selalu respond dengan JSON valid tanpa markdown, tanpa penjelasan tambahan, "
                               "tanpa teks pembuka atau penutup. Output HARUS dimulai dengan { dan diakhiri }."
                },
                {"role": "user", "content": prompt}
            ],
            format="json",   # paksa Ollama return JSON valid
            options={
                "temperature": 0.4,
                "num_predict": 2048,
            },
        )
        return response["message"]["content"]

    def _clean_json(self, text: str) -> str:
        text = re.sub(r"```json\s*", "", text)
        text = re.sub(r"```\s*", "", text)
        return text.strip()

    def _get_core_names(self, role: str) -> set:
        cfg = self.cfg.get(role, {})
        return set(cfg.get("core_topics", [])) | set(cfg.get("core_subtopics", []))

    def _get_advanced_names(self, role: str) -> set:
        cfg = self.cfg.get(role, {})
        return set(cfg.get("advanced_topics", [])) | set(cfg.get("advanced_subtopics", []))

    def _hours_per_week(self, duration_months: int) -> float:
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

    # ── 1. Learning Plan ──────────────────────────────────────────────────────

    def generate_learning_plan(
        self,
        role: str,
        duration_months: int,
    ) -> LearningPlan:
        print(f"\n[RAGEngine] Generating plan: role={role}, duration={duration_months} bulan")

        jsonl_path = Path(__file__).parent.parent.parent / "data" / "knowledge_base" / f"{role}.jsonl"
        if not jsonl_path.exists():
            raise FileNotFoundError(f"Knowledge base tidak ditemukan: {jsonl_path}")

        all_docs = [json.loads(l) for l in open(jsonl_path, encoding="utf-8")]

        core_names = self._get_core_names(role)
        adv_names  = self._get_advanced_names(role)

        core_docs, adv_docs, other_docs = [], [], []
        for d in all_docs:
            name = d["topic_name"]
            if name in core_names:
                core_docs.append(d)
            elif name in adv_names:
                adv_docs.append(d)
            else:
                other_docs.append(d)

        def sort_key(d):
            return (0 if d["topic_type"] == "topic" else 1, d.get("position_in_roadmap", 999))

        core_docs.sort(key=sort_key)
        adv_docs.sort(key=sort_key)

        total_weeks        = duration_months * 4
        hours_per_week     = self._hours_per_week(duration_months)
        hours_per_material = 2.0
        slots_per_week     = max(1, int(hours_per_week / hours_per_material))
        total_slots        = total_weeks * slots_per_week

        print(f"[RAGEngine] {total_weeks} minggu × {slots_per_week} materi/minggu = {total_slots} slot")
        print(f"[RAGEngine] Core: {len(core_docs)}, Advanced: {len(adv_docs)}, Other: {len(other_docs)}")

        selected: List[dict] = list(core_docs)
        remaining = total_slots - len(core_docs)
        if remaining > 0:
            take_adv = adv_docs[:remaining]
            selected.extend(take_adv)
            remaining -= len(take_adv)
        if remaining > 0:
            selected.extend(other_docs[:remaining])

        materials: List[Material] = []
        for i, d in enumerate(selected):
            week_num = min((i // slots_per_week) + 1, total_weeks)
            name     = d["topic_name"]
            priority = "core" if name in core_names else ("advanced" if name in adv_names else "supplementary")

            materials.append(Material(
                id=d["doc_id"],
                slug=d["slug"],
                title=name,
                role=role,
                topic_type=d["topic_type"],
                priority=priority,
                parent_topic=d.get("parent_topic", ""),
                content_summary=d["content"][:300].strip(),
                week_number=week_num,
                estimated_hours=hours_per_material,
            ))

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
            1: "Intensif — 10 jam/minggu. Fokus penuh pada core materials.",
            2: "Moderat — 8 jam/minggu. Seimbang antara core dan advanced.",
            3: "Santai — 7 jam/minggu. Ada ruang untuk eksplorasi lebih dalam.",
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

        print(f"[RAGEngine] ✓ {len(materials)} materi ({core_count} core, {adv_count} advanced)")
        return plan

    # ── 2. Quiz ───────────────────────────────────────────────────────────────

    def generate_quiz(
        self,
        material: dict,
        n_pg: int = 4,
        n_essay: int = 1,
    ) -> List[QuizQuestion]:
        print(f"[RAGEngine] Generating quiz: {material['title']}")

        context = self._retrieve_context(material["title"], material["role"], n=4)

        prompt = f"""Buat soal quiz untuk materi: {material['title']}

Konten materi:
{material.get('content_summary', '')}

Konteks tambahan:
{context[:800]}

Buat {n_pg} soal pilihan ganda (A/B/C/D) dan {n_essay} soal essay.

Respond dengan JSON:
{{
  "questions": [
    {{
      "type": "multiple_choice",
      "question": "pertanyaan",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "correct_answer": "A",
      "explanation": "penjelasan kenapa benar",
      "difficulty": "easy"
    }},
    {{
      "type": "essay",
      "question": "pertanyaan essay",
      "options": null,
      "correct_answer": null,
      "explanation": "poin-poin jawaban ideal",
      "difficulty": "medium"
    }}
  ]
}}"""

        raw  = self._llm(prompt)
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
        print(f"[RAGEngine] Generating livecode: {material['title']} [{difficulty}]")

        context = self._retrieve_context(material["title"], material["role"], n=3)
        role    = material["role"]

        lang_hint = {
            "backend":   "Go atau Python",
            "frontend":  "JavaScript atau TypeScript",
            "fullstack": "JavaScript/TypeScript (frontend) atau Node.js (backend)",
        }.get(role, "sesuai materi")

        mins = 20 if difficulty == "normal" else 35

        prompt = f"""Buat tantangan livecode untuk materi: {material['title']}
Bahasa: {lang_hint}
Level: {"soal standar untuk pemahaman dasar" if difficulty == "normal" else "soal kompleks, butuh pemahaman mendalam"}
Waktu: {mins} menit

Konteks:
{context[:600]}

Respond dengan JSON:
{{
  "title": "judul singkat",
  "description": "deskripsi soal lengkap dengan contoh input/output",
  "starter_code": "kode awal dengan TODO comments",
  "expected_behavior": "apa yang terjadi saat kode berjalan dengan benar",
  "hints": ["hint 1", "hint 2"],
  "difficulty": "{difficulty}",
  "estimated_minutes": {mins}
}}"""

        raw  = self._llm(prompt)
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

    # ── 4. Voice Challenge ────────────────────────────────────────────────────

    def generate_voice_challenge(
        self,
        material: dict,
        user_code_or_text: str,
        trigger_reason: str,
    ) -> VoiceChallenge:
        print(f"[RAGEngine] Generating voice challenge — trigger: {trigger_reason}")

        prompt = f"""User terdeteksi anomali: {trigger_reason}
Materi: {material['title']}

Kode/teks user:
\"\"\"
{user_code_or_text[:1000]}
\"\"\"

Buat 1 pertanyaan verifikasi suara yang sangat spesifik ke kode user.
Hanya bisa dijawab jika user benar-benar memahami apa yang ditulis.

Respond dengan JSON:
{{
  "question": "pertanyaan spesifik ke kode user",
  "context": "konteks singkat kenapa pertanyaan ini diajukan",
  "expected_keywords": ["kw1", "kw2", "kw3"],
  "time_limit_seconds": 120
}}"""

        raw  = self._llm(prompt)
        data = json.loads(self._clean_json(raw))

        return VoiceChallenge(
            trigger_reason=trigger_reason,
            question=data["question"],
            context=data.get("context", ""),
            expected_keywords=data["expected_keywords"],
            time_limit_seconds=data.get("time_limit_seconds", 120),
        )

    # ── 5. Final Challenge ────────────────────────────────────────────────────

    def generate_final_challenge(self, material: dict) -> FinalChallenge:
        print(f"[RAGEngine] Generating final challenge: {material['title']}")

        livecode = self.generate_livecode_challenge(material, difficulty="hard")

        prompt = f"""Buat instruksi voice explanation untuk tantangan berikut:
Materi: {material['title']}
Tantangan: {livecode.title}
Deskripsi: {livecode.description}

Buat kalimat yang meminta user menjelaskan kode yang baru ditulis via suara,
seperti interviewer sungguhan.

Respond dengan JSON:
{{
  "voice_prompt": "kalimat instruksi untuk user",
  "expected_keywords": ["kw1", "kw2", "kw3", "kw4", "kw5"]
}}"""

        raw  = self._llm(prompt)
        data = json.loads(self._clean_json(raw))

        return FinalChallenge(
            livecode=livecode,
            voice_explanation_prompt=data["voice_prompt"],
            expected_voice_keywords=data["expected_keywords"],
        )

    # ── Helper ────────────────────────────────────────────────────────────────

    def to_dict(self, obj) -> dict:
        return asdict(obj)