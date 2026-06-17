#!/usr/bin/env python3
import argparse
import json
import os
import time
from pathlib import Path

from build_knowledge_base import extract_urls, fetch_url_text, summarize_url_text

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROLE_FILES = ["backend.jsonl", "frontend.jsonl", "fullstack.jsonl"]


def load_jsonl(file_path: str) -> list[dict]:
    docs = []
    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            docs.append(json.loads(line))
    return docs


def save_jsonl(file_path: str, docs: list[dict]) -> None:
    with open(file_path, "w", encoding="utf-8") as f:
        for doc in docs:
            f.write(json.dumps(doc, ensure_ascii=False) + "\n")


def enrich_doc(doc: dict) -> dict:
    if doc.get("expanded_content"):
        return doc

    content = doc.get("content", "")
    content_with_links = doc.get("content_with_links", "")
    urls = extract_urls(content_with_links)
    summaries = []

    for url in urls:
        fetched = fetch_url_text(url)
        if not fetched:
            continue
        summary = summarize_url_text(fetched, max_chars=800)
        if summary:
            summaries.append({"url": url, "summary": summary})

    expanded = content
    if summaries:
        expanded += "\n\n" + "\n\n".join(
            f"Sumber: {item['url']}\n{item['summary']}" for item in summaries
        )

    doc["expanded_content"] = expanded.strip() or content
    return doc


def main():
    parser = argparse.ArgumentParser(description="Enrich existing knowledge base JSONL with external link summaries.")
    parser.add_argument("--kb-dir", default=os.path.join(BASE_DIR, "data/knowledge_base"), help="Path ke folder knowledge_base")
    parser.add_argument("--role", choices=["backend", "frontend", "fullstack"], help="Hanya enrich satu role saja")
    parser.add_argument("--inplace", action="store_true", help="Tulis hasil kembali ke file original")
    parser.add_argument("--limit", type=int, default=0, help="Batas jumlah dokumen yang diolah per file (0 = semua)")
    args = parser.parse_args()

    kb_dir = Path(args.kb_dir)
    if not kb_dir.exists() or not kb_dir.is_dir():
        raise FileNotFoundError(f"knowledge_base folder tidak ditemukan: {kb_dir}")

    files = ROLE_FILES if args.role is None else [f"{args.role}.jsonl"]
    summary = {}

    for file_name in files:
        source_path = kb_dir / file_name
        if not source_path.exists():
            print(f"[SKIP] {source_path} tidak ditemukan")
            continue

        docs = load_jsonl(str(source_path))
        total = len(docs)
        processed = 0
        enriched = 0

        print(f"Processing {file_name} ({total} docs){' - limit ' + str(args.limit) if args.limit else ''}")

        for index, doc in enumerate(docs):
            if args.limit and processed >= args.limit:
                break
            original = doc.copy()
            doc = enrich_doc(doc)
            if doc.get("expanded_content") and doc.get("expanded_content") != original.get("expanded_content", original.get("content", "")):
                enriched += 1
            processed += 1
            docs[index] = doc
            time.sleep(0.2)

        out_file = source_path if args.inplace else kb_dir / f"{source_path.stem}.enriched.jsonl"
        save_jsonl(str(out_file), docs)
        print(f"  ✓ saved {out_file} ({processed} docs, {enriched} enriched)")
        summary[file_name] = {
            "total_docs": total,
            "processed": processed,
            "enriched": enriched,
            "output_file": str(out_file),
        }

    print("\nSummary:")
    for file_name, stats in summary.items():
        print(f"  {file_name}: processed={stats['processed']} enriched={stats['enriched']} output={stats['output_file']}")


if __name__ == "__main__":
    main()
