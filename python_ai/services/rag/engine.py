import os
import json
import re
from typing import List, Optional
from dataclasses import dataclass, asdict
from pathlib import Path

from groq import Groq
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
    priority: str
    parent_topic: str
    content_summary: str
    week_number: Optional[int]
    estimated_hours: float
    status: str = "wajib"


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
    materials: List[dict]
    pace_note: str


@dataclass
class QuizQuestion:
    type: str
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
    LLM_MODEL    = "llama-3.3-70b-versatile"
    HOURS_PER_WEEK = {1: 10, 2: 8, 3: 7, 4: 6, 6: 5}

    def __init__(
        self,
        vector_store: VectorStore,
        api_key: str = "",
        host: str = "http://localhost:11434",   # host diabaikan, kept for compatibility
    ):
        # Ambil Groq key dari parameter atau env
        groq_key = api_key or os.getenv("GROQ_API_KEY", "")
        if not groq_key:
            raise ValueError(
                "GROQ_API_KEY tidak ditemukan. "
                "Set environment variable: $env:GROQ_API_KEY='gsk_...'"
            )

        self.client = Groq(api_key=groq_key)
        self.vs     = vector_store
        self.cfg    = _load_config()
        print(f"[RAGEngine] Ready — model: {self.LLM_MODEL} (Groq API)")

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _llm(self, prompt: str) -> str:
        """Call Groq API, return JSON string yang bersih."""
        models_to_try = [
            self.LLM_MODEL,
            "llama-3.1-8b-instant",
            "mixtral-8x7b-32768",
        ]
        
        last_error = None
        for model in models_to_try:
            try:
                print(f"[RAGEngine] Attempting LLM call using model: {model}")
                response = self.client.chat.completions.create(
                    model=model,
                    messages=[
                        {
                            "role": "system",
                            "content": (
                                "Kamu adalah AI assistant untuk platform pembelajaran VerifyLearn. "
                                "PENTING: Selalu respond HANYA dengan JSON valid. "
                                "Jangan tambahkan markdown, penjelasan, atau teks apapun di luar JSON. "
                                "Output harus dimulai dengan { dan diakhiri dengan }."
                            ),
                        },
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.3,
                    max_tokens=2048,
                    response_format={"type": "json_object"},  # paksa JSON output
                )
                raw = response.choices[0].message.content
                
                # Sanitasi: ambil JSON murni
                start = raw.find("{")
                end   = raw.rfind("}") + 1
                if start >= 0 and end > start:
                    raw = raw[start:end]
                return raw
            except Exception as e:
                print(f"[RAGEngine] Failed with model {model}: {e}")
                last_error = e
                continue
                
        raise last_error

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

    def generate_adaptive_learning_plan(self, role: str, level: str, commitment: float, duration_weeks: int) -> LearningPlan:
        print(f"\n[RAGEngine] Generating adaptive plan: role={role}, level={level}, commitment={commitment} hrs/day, duration_weeks={duration_weeks}")

        jsonl_path = Path(__file__).parent.parent.parent / "data" / "knowledge_base" / f"{role}.jsonl"
        if not jsonl_path.exists():
            raise FileNotFoundError(f"Knowledge base tidak ditemukan: {jsonl_path}")

        all_docs = [json.loads(l) for l in open(jsonl_path, encoding="utf-8")]
        core_names = self._get_core_names(role)
        adv_names  = self._get_advanced_names(role)

        # Build a structured list of available topics to pass to the LLM
        available_materials = []
        for d in all_docs:
            name = d["topic_name"]
            priority = "core" if name in core_names else ("advanced" if name in adv_names else "supplementary")
            available_materials.append({
                "slug": d["slug"],
                "title": name,
                "priority": priority,
                "parent_topic": d.get("parent_topic", ""),
                "summary": d["content"][:150].strip() + "..."
            })

        total_weeks = duration_weeks
        # Assuming each material takes ~2 hours of study time:
        # Weekly hours = commitment * 7
        # Max materials per week = floor(weekly hours / 2)
        slots_per_week = max(1, min(5, int((commitment * 7) / 2.0)))
        total_slots = total_weeks * slots_per_week

        prompt = f"""Kamu adalah pakar kurikulum pembelajaran IT. Rancanglah learning plan adaptif untuk peran {role} yang disesuaikan dengan profil pengguna berikut:
- Tingkat Keahlian Saat Ini: {level}
- Komitmen Belajar Harian: {commitment} jam/hari ({commitment * 7} jam/minggu)
- Durasi Belajar: {total_weeks} minggu
- Maksimal materi per minggu: {slots_per_week} materi (agar tidak menumpuk dan terlalu padat / "tidak seabrek")

Berikut adalah daftar materi pembelajaran yang tersedia dalam basis pengetahuan kurikulum kami:
{json.dumps(available_materials, indent=2)}

TUGAS:
1. Pilih materi dari daftar di atas yang paling relevan dengan profil pengguna.
   - Jika pengguna adalah "beginner" (pemula): Fokuskan pada materi "core" (dasar). Hindari topik "advanced" yang sangat rumit kecuali jika diletakkan di akhir minggu terakhir. Urutkan dari konsep yang paling mendasar ke kompleks (misal: HTML/CSS dulu baru Framework, Internet dulu baru API).
   - Jika pengguna adalah "intermediate" (menengah): Kompres materi dasar ke minggu-minggu awal, lalu berikan fokus lebih besar pada penerapan core-to-advanced.
   - Jika pengguna adalah "advanced" (mahir): Lewati materi dasar yang sangat sederhana (misal: "How does the internet work", "HTML/CSS basics"), atau gabungkan dengan cepat di Week 1. Berikan porsi terbesar pada arsitektur, optimasi, scaling, dan topik advanced lainnya.
2. Distribusikan materi yang dipilih ke dalam schedule mingguan (dari minggu 1 sampai minggu {total_weeks}). Setiap minggu maksimal berisi {slots_per_week} materi. Jangan memaksakan memasukkan semua materi jika tidak muat. Prioritaskan kualitas dan alur pembelajaran yang logis.
3. Buat catatan pacing ("pace_note") personal dalam Bahasa Indonesia yang menjelaskan mengapa kurikulum ini disesuaikan seperti ini untuk level {level} dengan komitmen {commitment} jam/hari.

Kembalikan hasil dalam format JSON persis seperti berikut:
{{
  "weekly_schedule": [
    {{
      "week": 1,
      "materials": ["slug-materi-1", "slug-materi-2"]
    }},
    {{
      "week": 2,
      "materials": ["slug-materi-3"]
    }}
  ],
  "pace_note": "Catatan penjelasan penyesuaian kurikulum di sini..."
}}"""

        try:
            raw = self._llm(prompt)
            data = json.loads(self._clean_json(raw))
        except Exception as e:
            print(f"[RAGEngine] AI plan generation or JSON parsing failed, using fallback plan: {e}")
            return self.generate_learning_plan(role, duration_weeks)

        # Resolve selected slugs to actual full material documents
        doc_map = {d["slug"]: d for d in all_docs}
        
        materials: List[Material] = []
        core_count = 0
        adv_count = 0
        scheduled_slugs = set()

        for week_item in data.get("weekly_schedule", []):
            week_num = int(week_item.get("week", 1))
            if week_num < 1 or week_num > total_weeks:
                continue
            
            week_slugs = week_item.get("materials", [])
            for slug in week_slugs[:slots_per_week]:
                if slug in doc_map and slug not in scheduled_slugs:
                    scheduled_slugs.add(slug)
                    d = doc_map[slug]
                    name = d["topic_name"]
                    priority = "core" if name in core_names else ("advanced" if name in adv_names else "supplementary")
                    
                    if priority == "core":
                        core_count += 1
                    elif priority == "advanced":
                        adv_count += 1

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
                        estimated_hours=2.0,
                        status="wajib"
                    ))

        if not materials:
            print("[RAGEngine] Resolved materials are empty, using fallback static plan.")
            return self.generate_learning_plan(role, duration_weeks)

        materials.sort(key=lambda m: m.week_number)

        from collections import defaultdict
        week_map = defaultdict(list)
        for m in materials:
            week_map[m.week_number].append(asdict(m))

        weekly_schedule = [
            {"week": w, "materials": week_map[w]}
            for w in range(1, total_weeks + 1) if week_map[w]
        ]

        all_materials_list = []
        for d in all_docs:
            slug = d["slug"]
            name = d["topic_name"]
            priority = "core" if name in core_names else ("advanced" if name in adv_names else "supplementary")
            
            scheduled_material = next((m for m in materials if m.slug == slug), None)
            
            if scheduled_material:
                status = "wajib"
                week_number = scheduled_material.week_number
            else:
                week_number = None
                if total_weeks <= 2:
                    status = "dilewati"
                elif level == "advanced":
                    if priority == "core":
                        status = "dilewati"
                    else:
                        status = "pilihan"
                elif level == "intermediate":
                    pos = d.get("position_in_roadmap", 999)
                    if priority == "core" and pos <= 4:
                        status = "dilewati"
                    else:
                        status = "pilihan"
                else:
                    status = "pilihan"
            
            all_materials_list.append({
                "id": d["doc_id"],
                "slug": slug,
                "title": name,
                "role": role,
                "topic_type": d["topic_type"],
                "priority": priority,
                "parent_topic": d.get("parent_topic", ""),
                "content_summary": d["content"][:300].strip(),
                "week_number": week_number,
                "estimated_hours": 2.0,
                "status": status
            })

        pace_note = data.get("pace_note", f"Pacing disesuaikan untuk level {level} dengan komitmen {commitment} jam/hari.")

        plan = LearningPlan(
            role=role,
            duration_months=int((total_weeks + 3) / 4),
            total_weeks=total_weeks,
            hours_per_week=commitment * 7.0,
            total_materials=len(all_materials_list),
            core_materials=sum(1 for m in all_materials_list if m["priority"] == "core"),
            advanced_materials=sum(1 for m in all_materials_list if m["priority"] == "advanced"),
            weekly_schedule=weekly_schedule,
            materials=all_materials_list,
            pace_note=pace_note
        )
        print(f"[RAGEngine] Adaptive plan generated: {len(weekly_schedule)} active weeks, {len(all_materials_list)} total materials")
        return plan

    def generate_learning_plan(self, role: str, duration_weeks: int) -> LearningPlan:
        print(f"\n[RAGEngine] Generating plan: role={role}, duration_weeks={duration_weeks}")

        jsonl_path = Path(__file__).parent.parent.parent / "data" / "knowledge_base" / f"{role}.jsonl"
        if not jsonl_path.exists():
            raise FileNotFoundError(f"Knowledge base tidak ditemukan: {jsonl_path}")

        all_docs   = [json.loads(l) for l in open(jsonl_path, encoding="utf-8")]
        core_names = self._get_core_names(role)
        adv_names  = self._get_advanced_names(role)

        core_docs, adv_docs, other_docs = [], [], []
        for d in all_docs:
            name = d["topic_name"]
            if name in core_names:       core_docs.append(d)
            elif name in adv_names:      adv_docs.append(d)
            else:                        other_docs.append(d)

        def sort_key(d):
            return (0 if d["topic_type"] == "topic" else 1, d.get("position_in_roadmap", 999))

        core_docs.sort(key=sort_key)
        adv_docs.sort(key=sort_key)

        total_weeks = duration_weeks
        if total_weeks <= 1:
            hours_per_week = 10.0
        elif total_weeks <= 2:
            hours_per_week = 8.0
        elif total_weeks <= 4:
            hours_per_week = 8.0
        elif total_weeks <= 12:
            hours_per_week = 6.0
        else:
            hours_per_week = 5.0

        hours_per_material = 2.0
        slots_per_week     = max(1, int(hours_per_week / hours_per_material))
        total_slots        = total_weeks * slots_per_week

        print(f"[RAGEngine] {total_weeks} minggu × {slots_per_week} materi/minggu = {total_slots} slot")
        print(f"[RAGEngine] Core: {len(core_docs)}, Advanced: {len(adv_docs)}, Other: {len(other_docs)}")

        selected: List[dict] = []
        if total_slots <= len(core_docs):
            selected = list(core_docs[:total_slots])
        else:
            selected = list(core_docs)
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
                id=d["doc_id"], slug=d["slug"], title=name, role=role,
                topic_type=d["topic_type"], priority=priority,
                parent_topic=d.get("parent_topic", ""),
                content_summary=d["content"][:300].strip(),
                week_number=week_num, estimated_hours=hours_per_material,
            ))

        from collections import defaultdict
        week_map = defaultdict(list)
        for m in materials:
            week_map[m.week_number].append(asdict(m))

        weekly_schedule = [
            {"week": w, "materials": week_map[w]}
            for w in range(1, total_weeks + 1) if week_map[w]
        ]

        core_count = sum(1 for m in materials if m.priority == "core")
        adv_count  = sum(1 for m in materials if m.priority == "advanced")

        pace_note = f"{hours_per_week} hours/week, {total_weeks} weeks total."

        # Construct flat list of ALL materials with dynamic statuses for fallback
        all_materials_list = []
        scheduled_slugs_static = {m.slug for m in materials}
        for d in all_docs:
            slug = d["slug"]
            name = d["topic_name"]
            priority = "core" if name in core_names else ("advanced" if name in adv_names else "supplementary")
            status = "wajib" if slug in scheduled_slugs_static else ("dilewati" if total_weeks <= 2 else "pilihan")
            
            scheduled_material = next((m for m in materials if m.slug == slug), None)
            week_number = scheduled_material.week_number if scheduled_material else None
            
            all_materials_list.append({
                "id": d["doc_id"],
                "slug": slug,
                "title": name,
                "role": role,
                "topic_type": d["topic_type"],
                "priority": priority,
                "parent_topic": d.get("parent_topic", ""),
                "content_summary": d["content"][:300].strip(),
                "week_number": week_number,
                "estimated_hours": hours_per_material,
                "status": status
            })

        plan = LearningPlan(
            role=role, duration_months=int((total_weeks + 3) / 4),
            total_weeks=total_weeks, hours_per_week=hours_per_week,
            total_materials=len(all_materials_list), core_materials=core_count,
            advanced_materials=adv_count, weekly_schedule=weekly_schedule,
            materials=all_materials_list,
            pace_note=pace_note,
        )
        print(f"[RAGEngine] ✓ fallback plan: {len(all_materials_list)} total materials")
        return plan

    # ── 2. Quiz ───────────────────────────────────────────────────────────────

    def generate_quiz(self, material: dict, n_pg: int = 4, n_essay: int = 1) -> List[QuizQuestion]:
        print(f"[RAGEngine] Generating quiz: {material['title']}")
        context = self._retrieve_context(material["title"], material["role"], n=4)

        prompt = f"""Buat soal quiz untuk materi backend development: {material['title']}

Konten:
{material.get('content_summary', '')[:400]}

Referensi:
{context[:600]}

Tugas:
1. Buat {n_pg} soal pilihan ganda dengan 4 opsi (A/B/C/D)
2. Buat {n_essay} soal essay terbuka (TANPA options, TANPA correct_answer)

Format JSON (ikuti PERSIS struktur ini):
{{
  "questions": [
    {{
      "type": "multiple_choice",
      "question": "Apa fungsi utama dari HTTP dalam komunikasi web?",
      "options": ["A. Menyimpan data", "B. Transfer hypertext antara client dan server", "C. Mengenkripsi koneksi", "D. Mengelola database"],
      "correct_answer": "B",
      "explanation": "HTTP adalah protokol untuk transfer hypertext antara client dan server",
      "difficulty": "easy"
    }},
    {{
      "type": "essay",
      "question": "Jelaskan perbedaan antara HTTP dan HTTPS beserta kapan sebaiknya digunakan",
      "options": null,
      "correct_answer": null,
      "explanation": "Jawaban harus mencakup: enkripsi SSL/TLS, keamanan data, penggunaan di production",
      "difficulty": "medium"
    }}
  ]
}}"""

        raw  = self._llm(prompt)
        data = json.loads(self._clean_json(raw))
        return [
            QuizQuestion(
                type=q["type"], question=q["question"],
                options=q.get("options"), correct_answer=q.get("correct_answer"),
                explanation=q.get("explanation", ""), difficulty=q.get("difficulty", "medium"),
            )
            for q in data["questions"]
        ]

    # ── 3. Livecode Challenge ─────────────────────────────────────────────────

    def generate_livecode_challenge(self, material: dict, difficulty: str = "normal") -> LivecodeChallenge:
        print(f"[RAGEngine] Generating livecode: {material['title']} [{difficulty}]")
        context  = self._retrieve_context(material["title"], material["role"], n=3)
        role     = material["role"]
        lang_hint = {
            "backend":   "Go atau Python",
            "frontend":  "JavaScript atau TypeScript",
            "fullstack": "JavaScript/TypeScript atau Node.js",
        }.get(role, "sesuai materi")
        mins = 20 if difficulty == "normal" else 35

        prompt = f"""Buat tantangan coding untuk materi: {material['title']}
Bahasa: {lang_hint}
Estimasi waktu: {mins} menit
Level: {"standar — buktikan pemahaman dasar konsep" if difficulty == "normal" else "kompleks — butuh pemahaman mendalam, tidak bisa diselesaikan dengan copy-paste"}

Referensi materi:
{context[:500]}

Starter code HARUS berisi kode nyata (fungsi/class dengan TODO), bukan URL atau teks biasa.

Respond dengan JSON:
{{
  "title": "judul singkat tantangan",
  "description": "deskripsi soal: apa yang harus diimplementasikan, contoh input dan output yang diharapkan",
  "starter_code": "# Implementasikan fungsi berikut\\ndef solve(input_data):\\n    # TODO: tulis implementasimu di sini\\n    pass",
  "expected_behavior": "deskripsi output yang benar saat kode dijalankan dengan benar",
  "hints": ["hint teknikal konkret 1", "hint teknikal konkret 2"],
  "difficulty": "{difficulty}",
  "estimated_minutes": {mins}
}}"""

        raw  = self._llm(prompt)
        data = json.loads(self._clean_json(raw))
        return LivecodeChallenge(
            title=data["title"], description=data["description"],
            starter_code=data["starter_code"], expected_behavior=data["expected_behavior"],
            hints=data.get("hints", []), difficulty=data["difficulty"],
            estimated_minutes=data["estimated_minutes"],
        )

    # ── 4. Voice Challenge ────────────────────────────────────────────────────

    def generate_voice_challenge(
        self, material: dict, user_code_or_text: str, trigger_reason: str
    ) -> VoiceChallenge:
        print(f"[RAGEngine] Generating voice challenge — trigger: {trigger_reason}")

        prompt = f"""Kamu adalah interviewer teknikal yang mendeteksi anomali.

Situasi: {trigger_reason}
Materi yang dikerjakan: {material['title']}

Kode yang ditulis user:
---
{user_code_or_text[:800]}
---

Buat 1 pertanyaan verifikasi suara yang:
- Menanyakan SPESIFIK tentang baris kode tertentu yang ditulis user
- Menyebut nama fungsi/variabel/konsep konkret dari kode di atas
- Tidak bisa dijawab dengan jawaban umum/generik
- Memaksa user menjelaskan MENGAPA kode tersebut bekerja seperti itu

Respond dengan JSON:
{{
  "question": "pertanyaan spesifik yang menyebut nama fungsi atau variabel dari kode user",
  "context": "alasan kenapa pertanyaan ini diajukan berdasarkan kode user",
  "expected_keywords": ["keyword teknikal 1", "keyword teknikal 2", "keyword teknikal 3"],
  "time_limit_seconds": 120
}}"""

        raw  = self._llm(prompt)
        data = json.loads(self._clean_json(raw))
        return VoiceChallenge(
            trigger_reason=trigger_reason, question=data["question"],
            context=data.get("context", ""), expected_keywords=data["expected_keywords"],
            time_limit_seconds=data.get("time_limit_seconds", 120),
        )

    # ── 5. Final Challenge ────────────────────────────────────────────────────

    def generate_final_challenge(self, material: dict) -> FinalChallenge:
        print(f"[RAGEngine] Generating final challenge: {material['title']}")
        livecode = self.generate_livecode_challenge(material, difficulty="hard")

        prompt = f"""Buat instruksi voice explanation untuk tantangan coding berikut:
Materi: {material['title']}
Judul tantangan: {livecode.title}
Deskripsi: {livecode.description}

Buat kalimat instruksi yang meminta user menjelaskan kode yang baru ditulis via suara.
Gunakan bahasa seperti interviewer sungguhan — spesifik, tidak generik.

Respond dengan JSON:
{{
  "voice_prompt": "kalimat instruksi spesifik untuk user menjelaskan kodenya",
  "expected_keywords": ["keyword teknikal 1", "keyword teknikal 2", "keyword teknikal 3", "keyword teknikal 4", "keyword teknikal 5"]
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