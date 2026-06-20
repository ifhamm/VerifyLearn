#!/usr/bin/env python3
import os
import sys
from typing import List, Optional
from dataclasses import asdict
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# Ensure local imports work correctly
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from services.rag.embedder import LocalEmbedder
from services.rag.vectorstore import VectorStore
from services.rag.engine import RAGEngine

app = FastAPI(title="VerifyLearn AI Engine API", version="1.0.0")

# Initialize global AI engines
db_dir = os.path.join(BASE_DIR, "chroma_db")
embedder = LocalEmbedder()
vector_store = VectorStore(embedder=embedder, persist_dir=db_dir)
engine = RAGEngine(vector_store=vector_store)

# ── Pydantic Request Models ──────────────────────────────────────────────────

class KeystrokeEvent(BaseModel):
    key: str
    time: int
    type: str  # keydown or keyup

class KeystrokePayload(BaseModel):
    keystrokes: List[KeystrokeEvent]

class MaterialInput(BaseModel):
    id: Optional[str] = None
    slug: Optional[str] = None
    title: str
    role: str
    topic_type: Optional[str] = None
    priority: Optional[str] = None
    parent_topic: Optional[str] = None
    content_summary: Optional[str] = None
    week_number: Optional[int] = None
    estimated_hours: Optional[float] = None

class QuizRequest(BaseModel):
    material: MaterialInput
    n_pg: int = 4
    n_essay: int = 1

class LivecodeRequest(BaseModel):
    material: MaterialInput
    difficulty: str = "normal"

class VoiceChallengeRequest(BaseModel):
    material: MaterialInput
    user_code_or_text: str
    trigger_reason: str

class FinalChallengeRequest(BaseModel):
    material: MaterialInput

# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "chroma_docs_count": vector_store.count(),
        "llm_model": engine.LLM_MODEL
    }

@app.post("/api/verify-keystroke")
def verify_keystroke(payload: KeystrokePayload):
    events = payload.keystrokes
    
    # Filter only keydown events for speed/bot analysis
    keydowns = [e for e in events if e.type == "keydown"]
    if len(keydowns) < 5:
        return {
            "verified": False,
            "confidence": 0.0,
            "message": "Data ketikan terlalu sedikit untuk dianalisis (min. 5 tombol).",
            "metrics": {
                "wpm": 0,
                "instant_ratio": 0,
                "avg_dwell_ms": 0,
                "std_flight_ms": 0
            }
        }
        
    keydown_times = [e.time for e in keydowns]
    total_chars = len(keydowns)
    total_time_ms = max(keydown_times) - min(keydown_times)
    
    # 1. Hitung WPM (Words Per Minute) - 1 kata diasumsikan 5 karakter
    minutes = total_time_ms / 60000.0
    wpm = (total_chars / 5.0) / minutes if minutes > 0 else 0
    
    # 2. Deteksi copy-paste instan (interval ketikan mendekati nol)
    instant_count = 0
    deltas = []
    for i in range(1, len(keydown_times)):
        delta = keydown_times[i] - keydown_times[i-1]
        deltas.append(delta)
        if delta < 5:  # kurang dari 5ms dianggap instan (copy-paste / bot injection)
            instant_count += 1
            
    instant_ratio = instant_count / (len(keydown_times) - 1) if len(keydown_times) > 1 else 0
    
    # 3. Hitung Dwell Time (Durasi tombol ditekan)
    dwell_times = []
    keydown_map = {}
    for e in events:
        if e.type == "keydown":
            keydown_map[e.key] = e.time
        elif e.type == "keyup" and e.key in keydown_map:
            dwell = e.time - keydown_map[e.key]
            if dwell >= 0:
                dwell_times.append(dwell)
            del keydown_map[e.key]
            
    # 4. Deteksi Konsistensi Ritme (Standar Deviasi Flight Time)
    std_delta = 0.0
    if len(deltas) >= 5:
        mean_delta = sum(deltas) / len(deltas)
        var_delta = sum((d - mean_delta) ** 2 for d in deltas) / len(deltas)
        std_delta = var_delta ** 0.5
        
    # Heuristik Evaluasi
    verified = True
    confidence = 1.0
    reasons = []
    
    # Deteksi copy-paste masif
    if instant_ratio > 0.25:
        verified = False
        confidence = 0.1
        reasons.append("Terdeteksi copy-paste instan.")
        
    # Deteksi Bot (Kecepatan terlalu tinggi)
    if wpm > 220:
        verified = False
        confidence = 0.15
        reasons.append(f"Kecepatan ketikan tidak normal ({wpm:.1f} WPM).")
    elif wpm < 8:
        confidence = 0.6
        reasons.append(f"Kecepatan ketikan sangat lambat ({wpm:.1f} WPM).")
        
    # Deteksi Bot Konsisten Sempurna (Ketikan mesin dengan interval seragam)
    if len(deltas) >= 8 and std_delta < 4.0:
        verified = False
        confidence = 0.2
        reasons.append("Ritme ketikan terlalu konsisten (kemungkinan bot peniru ketikan).")
        
    message = "Pola ketikan terverifikasi aman." if verified else "Terdeteksi anomali integritas: " + ", ".join(reasons)
    
    return {
        "verified": verified,
        "confidence": round(confidence, 2),
        "message": message,
        "metrics": {
            "wpm": round(wpm, 1),
            "instant_ratio": round(instant_ratio, 3),
            "avg_dwell_ms": round(sum(dwell_times) / len(dwell_times), 1) if dwell_times else 0.0,
            "std_flight_ms": round(std_delta, 1)
        }
    }

@app.post("/api/generate-quiz")
def generate_quiz(payload: QuizRequest):
    try:
        # Convert Pydantic model back to regular dict for engine
        material_dict = payload.material.model_dump()
        questions = engine.generate_quiz(
            material=material_dict,
            n_pg=payload.n_pg,
            n_essay=payload.n_essay
        )
        return {
            "status": "success",
            "data": [asdict(q) for q in questions]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/generate-livecode")
def generate_livecode(payload: LivecodeRequest):
    try:
        material_dict = payload.material.model_dump()
        challenge = engine.generate_livecode_challenge(
            material=material_dict,
            difficulty=payload.difficulty
        )
        return {
            "status": "success",
            "data": asdict(challenge)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/generate-voice-challenge")
def generate_voice_challenge(payload: VoiceChallengeRequest):
    try:
        material_dict = payload.material.model_dump()
        challenge = engine.generate_voice_challenge(
            material=material_dict,
            user_code_or_text=payload.user_code_or_text,
            trigger_reason=payload.trigger_reason
        )
        return {
            "status": "success",
            "data": asdict(challenge)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/generate-final-challenge")
def generate_final_challenge(payload: FinalChallengeRequest):
    try:
        material_dict = payload.material.model_dump()
        challenge = engine.generate_final_challenge(material=material_dict)
        return {
            "status": "success",
            "data": asdict(challenge)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
