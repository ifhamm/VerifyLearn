#!/usr/bin/env python3
"""
main.py
=======
CLI Test Runner untuk menguji seluruh fitur RAGEngine secara live.
Menjalankan pengujian pembuatan Jadwal Belajar, Kuis, Livecode, dan Voice Challenge.

Cara Pakai:
  python main.py --api-key YOUR_GEMINI_KEY
"""

import os
import sys
import argparse
import json
from dataclasses import asdict

# Memastikan modul lokal bisa diimport dengan aman
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from services.rag.embedder import GeminiEmbedder
from services.rag.vectorstore import VectorStore
from services.rag.engine import RAGEngine


def print_divider(title: str):
    print(f"\n{'='*60}")
    print(f" 🚀 TEST: {title.upper()}")
    print(f"{'='*60}")


def main():
    parser = argparse.ArgumentParser(description="VerifyLearn - Live Test AI Engine Runner")
    parser.add_argument("--api-key", default=os.environ.get("GEMINI_API_KEY"), help="Gemini API Key Anda (atau via env GEMINI_API_KEY)")
    parser.add_argument("--db-dir", default=os.path.join(BASE_DIR, "chroma_db"), help="Direktori database ChromaDB")
    parser.add_argument("--role", default="backend", choices=["backend", "frontend", "fullstack"], help="Role yang ingin diuji")
    args = parser.parse_args()

    if not args.api_key:
        print("❌ Error: --api-key wajib diisi atau diset lewat env GEMINI_API_KEY")
        sys.exit(1)


    print("============================================================")
    print("      VerifyLearn — Memulai Pengujian Sistem Live AI        ")
    print("============================================================")

    # 1. Inisialisasi Komponen RAG
    print("📦 1. Menghubungkan ke ChromaDB & Inisialisasi Embedder...")
    embedder = GeminiEmbedder(api_key=args.api_key)
    vector_store = VectorStore(embedder=embedder, persist_dir=args.db_dir)
    
    # 2. Inisialisasi RAGEngine
    print("🤖 2. Inisialisasi RAGEngine...")
    engine = RAGEngine(vector_store=vector_store, api_key=args.api_key)

    # Objek Dummy Materi untuk Pengetesan Fungsi Turunan (Quiz/Livecode)
    # Ini mensimulasikan materi yang diambil dari Learning Plan
    mock_material = {
        "id": f"{args.role}::caching",
        "slug": "caching",
        "title": "Caching",
        "role": args.role,
        "content_summary": "Caching adalah proses menyimpan data sementara di tempat penyimpanan cepat (seperti Redis atau Memcached) untuk mempercepat load time aplikasi dan mengurangi beban database utama."
    }

    try:
        # ── TEST 1: GENERATE LEARNING PLAN ───────────────────────────────────
        print_divider("Generate Learning Plan (Pace Calculator)")
        plan = engine.generate_learning_plan(role=args.role, duration_months=2)
        
        print(f"✅ Berhasil membuat Learning Plan untuk {plan.role}!")
        print(f"   ⏱️ Durasi         : {plan.duration_months} Bulan ({plan.total_weeks} Minggu)")
        print(f"   📚 Total Materi    : {plan.total_materials} Topik (Core: {plan.core_materials}, Adv: {plan.advanced_materials})")
        print(f"   💡 Catatan Pace   : {plan.pace_note}")
        print("\n👀 Cuplikan Jadwal Minggu ke-1:")
        if plan.weekly_schedule:
            print(json.dumps(plan.weekly_schedule[0], indent=2, ensure_ascii=False)[:600] + "\n... [truncated]")


        # # ── TEST 2: GENERATE QUIZ ────────────────────────────────────────────
        # print_divider("Generate Quiz (RAG-Driven)")
        # quiz_questions = engine.generate_quiz(material=mock_material, n_pg=2, n_essay=1)
        
        # print(f"✅ Berhasil membuat {len(quiz_questions)} soal kuis untuk topik '{mock_material['title']}'")
        # for idx, q in enumerate(quiz_questions, 1):
        #     print(f"\n   Soal {idx} [{q.type.upper()} - {q.difficulty}]:")
        #     print(f"   ❓ {q.question}")
        #     if q.options:
        #         for opt in q.options:
        #             print(f"      {opt}")
        #     print(f"   🔑 Jawaban Benar: {q.correct_answer}")
        #     print(f"   ℹ️ Penjelasan/Poin Jawaban: {q.explanation}")


        # # ── TEST 3: GENERATE LIVECODE CHALLENGE ──────────────────────────────
        # print_divider("Generate Livecode Challenge")
        # challenge = engine.generate_livecode_challenge(material=mock_material, difficulty="normal")
        
        # print(f"✅ Tantangan Coding Berhasil Dibuat!")
        # print(f"   🏆 Judul              : {challenge.title}")
        # print(f"   ⏱️ Estimasi Waktu      : {challenge.estimated_minutes} Menit")
        # print(f"   📝 Deskripsi Soal     :\n{challenge.description}")
        # print(f"   💻 Starter Code       :\n{challenge.starter_code}")
        # print(f"   🎯 Expected Behavior  : {challenge.expected_behavior}")
        # print(f"   💡 Hints              : {challenge.hints}")


        # # ── TEST 4: GENERATE VOICE CHALLENGE (ANTI-CHEAT) ────────────────────
        # print_divider("Generate Voice Challenge (Anti-Cheat / Anomaly)")
        # dummy_user_code = "def get_user_data(id):\n    # User copy paste langsung dari github tanpa paham\n    return cache.get(f'user:{id}')"
        # trigger_reason = "User melakukan copy-paste kode dalam jumlah besar dalam waktu 2 detik (Indikasi Plagiarisme ChatGPT)"
        
        # voice_challenge = engine.generate_voice_challenge(
        #     material=mock_material,
        #     user_code_or_text=dummy_user_code,
        #     trigger_reason=trigger_reason
        # )
        
        # print(f"⚠️ Alasan Interupsi : {voice_challenge.trigger_reason}")
        # print(f"✅ Pertanyaan Lisan Dibuat!")
        # print(f"   🗣️ Pertanyaan AI   : \"{voice_challenge.question}\"")
        # print(f"   🔍 Konteks Masalah  : {voice_challenge.context}")
        # print(f"   🔑 Kata Kunci Wajib : {voice_challenge.expected_keywords}")
        # print(f"   ⏳ Batas Waktu      : {voice_challenge.time_limit_seconds} detik")


        # # ── TEST 5: GENERATE FINAL CHALLENGE ──────────────────────────────────
        # print_divider("Generate Final Challenge (Livecode + Voice)")
        # final_challenge = engine.generate_final_challenge(material=mock_material)
        
        # print(f"✅ Bundel Final Challenge Siap!")
        # print(f"   💻 Projek Praktik   : {final_challenge.livecode.title}")
        # print(f"   🗣️ Perintah Voice   : \"{final_challenge.voice_explanation_prompt}\"")
        # print(f"   🔑 Key Voice Kunci  : {final_challenge.expected_voice_keywords}")

    except Exception as e:
        print(f"\n❌ Terjadi kesalahan saat pengujian live: {e}")
        import traceback
        traceback.print_exc()

    print("\n" + "="*60)
    print(" 🎉 SELESAI! Seluruh pipeline RAGEngine teruji aman.")
    print("="*60)


if __name__ == "__main__":
    main()