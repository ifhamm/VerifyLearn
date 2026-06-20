#!/usr/bin/env python3
"""
build_question_bank.py
======================
Ekstrak bank soal dari roadmap.sh question-groups dan ingest ke ChromaDB.

Cara pakai:
  python scripts/build_question_bank.py --question-dir "D:/path/to/developer-roadmap/src/data/question-groups"
  python scripts/build_question_bank.py --question-dir "..." --no-ingest
"""

import json, os, re, sys, argparse, shutil
from pathlib import Path
from dataclasses import dataclass, asdict

# BASE_DIR menunjuk ke python_ai/ (bukan python_ai/scripts/)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

ROLE_MAPPING = {
    "backend":    {"role": "backend",   "tag": "backend-general"},
    "golang":     {"role": "backend",   "tag": "golang"},
    "frontend":   {"role": "frontend",  "tag": "frontend-general"},
    "javascript": {"role": "frontend",  "tag": "javascript"},
    "react":      {"role": "frontend",  "tag": "react"},
    "full-stack": {"role": "fullstack", "tag": "fullstack-general"},
    "nodejs":     {"role": "fullstack", "tag": "nodejs"},
}


@dataclass
class QuestionDoc:
    doc_id: str
    role: str
    tag: str
    question: str
    answer: str
    difficulty: str
    source_folder: str
    rag_text: str


def parse_questions_from_md(md_content: str) -> list:
    pattern = re.compile(
        r'-\s+question:\s+(.+?)\n\s+answer:\s+(\S+)\n\s+topics:\n\s+-\s+[\'"]?(.+?)[\'"]?\n'
    )
    results = []
    for m in pattern.finditer(md_content):
        results.append({
            "question":    m.group(1).strip().strip("'\""),
            "answer_file": m.group(2).strip(),
            "difficulty":  m.group(3).strip().strip("'\""),
        })
    return results


def difficulty_label(raw: str) -> str:
    r = raw.lower()
    if "beginner" in r: return "Beginner"
    if "advanced" in r: return "Advanced"
    return "Intermediate"


def format_rag(doc: "QuestionDoc") -> str:
    return (
        f"TIPE: Interview Question / Bank Soal\n"
        f"ROLE: {doc.role}\n"
        f"TOPIK: {doc.tag}\n"
        f"DIFFICULTY: {doc.difficulty}\n\n"
        f"PERTANYAAN: {doc.question}\n\n"
        f"JAWABAN: {doc.answer}"
    )


def extract_questions(question_dir: str, output_dir: str) -> dict:
    os.makedirs(output_dir, exist_ok=True)
    role_counts: dict = {}

    for folder_name, mapping in ROLE_MAPPING.items():
        folder      = Path(question_dir) / folder_name
        md_file     = folder / f"{folder_name}.md"
        content_dir = folder / "content"

        if not folder.exists() or not md_file.exists() or not content_dir.exists():
            print(f"  [SKIP] {folder_name}")
            continue

        role = mapping["role"]
        tag  = mapping["tag"]
        print(f"\n[Extract] {folder_name} → role={role}, tag={tag}")

        questions   = parse_questions_from_md(md_file.read_text(encoding="utf-8"))
        output_path = Path(output_dir) / f"{role}_questions.jsonl"
        added       = 0

        with open(output_path, "a", encoding="utf-8") as f:
            for i, q in enumerate(questions):
                ans_path = content_dir / q["answer_file"]
                if not ans_path.exists():
                    continue
                answer = ans_path.read_text(encoding="utf-8").strip()
                if len(answer) < 20:
                    continue

                doc = QuestionDoc(
                    doc_id=f"{role}_q::{tag}::{i}",
                    role=role, tag=tag,
                    question=q["question"],
                    answer=answer,
                    difficulty=difficulty_label(q["difficulty"]),
                    source_folder=folder_name,
                    rag_text="",
                )
                doc.rag_text = format_rag(doc)
                f.write(json.dumps(asdict(doc), ensure_ascii=False) + "\n")
                added += 1

        role_counts[role] = role_counts.get(role, 0) + added
        print(f"  ✓ {added} soal → {output_path.name}")

    return role_counts


def ingest_questions(kb_dir: str, db_dir: str):
    from services.rag.embedder import GeminiEmbedder
    import chromadb
    from chromadb.config import Settings

    print(f"\n{'='*50}\nIngesting bank soal ke ChromaDB (collection: question_bank)...")

    embedder = GeminiEmbedder()
    client   = chromadb.PersistentClient(
        path=db_dir,
        settings=Settings(anonymized_telemetry=False),
    )
    col = client.get_or_create_collection(
        name="question_bank",
        metadata={"hnsw:space": "cosine"},
    )
    print(f"[QuestionBank] Sudah ada: {col.count()} soal")

    for role in ["backend", "frontend", "fullstack"]:
        jsonl = Path(kb_dir) / f"{role}_questions.jsonl"
        if not jsonl.exists():
            print(f"  [SKIP] {jsonl.name}")
            continue

        docs = [json.loads(l) for l in open(jsonl, encoding="utf-8")]
        print(f"\n[{role}] {len(docs)} soal ditemukan...")

        # Filter sudah ada
        new_docs = []
        for d in docs:
            try:
                if not col.get(ids=[d["doc_id"]])["ids"]:
                    new_docs.append(d)
            except:
                new_docs.append(d)

        if not new_docs:
            print(f"  Semua sudah ada, skip.")
            continue

        print(f"  Embedding {len(new_docs)} soal baru...")
        embeddings = embedder.embed_documents_batch([d["rag_text"] for d in new_docs])

        col.add(
            ids=[d["doc_id"] for d in new_docs],
            embeddings=embeddings,
            documents=[d["rag_text"] for d in new_docs],
            metadatas=[{
                "role":       d["role"],
                "tag":        d["tag"],
                "difficulty": d["difficulty"],
                "question":   d["question"][:200],
            } for d in new_docs],
        )
        print(f"  ✓ {len(new_docs)} soal berhasil diingest")

    print(f"\n✓ Total soal di question_bank: {col.count()}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--question-dir", required=True)
    parser.add_argument("--output-dir", default=os.path.join(BASE_DIR, "data/question_bank"))
    parser.add_argument("--db-dir",     default=os.path.join(BASE_DIR, "chroma_db"))
    parser.add_argument("--no-ingest",  action="store_true")
    args = parser.parse_args()

    print("=" * 50)
    print("  VerifyLearn — Question Bank Builder")
    print("=" * 50)

    # Bersihkan output lama supaya tidak duplikat saat re-run
    if os.path.exists(args.output_dir):
        shutil.rmtree(args.output_dir)

    summary = extract_questions(args.question_dir, args.output_dir)

    print(f"\n{'='*50}\n  SUMMARY\n{'='*50}")
    total = 0
    for role, count in summary.items():
        print(f"  {role:12s}: {count} soal")
        total += count
    print(f"  {'TOTAL':12s}: {total} soal")

    if not args.no_ingest:
        ingest_questions(args.output_dir, args.db_dir)

    print("\n✓ Selesai!")


if __name__ == "__main__":
    main()