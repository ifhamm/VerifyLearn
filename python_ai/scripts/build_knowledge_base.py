#!/usr/bin/env python3
"""
build_knowledge_base.py
=======================
Ekstrak konten dari roadmap.sh dan bangun knowledge base RAG
yang terstruktur per role (backend, frontend, fullstack).

Cara pakai:
  # 1. Ekstrak dan bangun file knowledge base
  python scripts/build_knowledge_base.py --roadmap-dir /path/to/developer-roadmap/src/data/roadmaps

  # 2. Setelah extract, ingest ke ChromaDB
  python scripts/build_knowledge_base.py --roadmap-dir ... --ingest

Output:
  data/knowledge_base/backend.jsonl
  data/knowledge_base/frontend.jsonl
  data/knowledge_base/fullstack.jsonl
  data/knowledge_base/summary.json
"""

import json
import os
import re
import argparse
import socket
import sys
import time
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# BASE_DIR menunjuk ke python_ai/ (bukan python_ai/scripts/)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)


# ── Data structures ──────────────────────────────────────────────────────────

@dataclass
class KnowledgeDoc:
    """Satu dokumen dalam knowledge base — satu topik dari roadmap."""
    doc_id: str          # unik: role + slug, e.g. "backend::caching"
    role: str            # backend | frontend | fullstack
    topic_name: str      # label dari JSON node, e.g. "Caching"
    topic_type: str      # topic | subtopic
    parent_topic: str    # parent topic label (untuk konteks hierarki)
    slug: str            # slug dari filename, e.g. "caching"
    content: str         # isi .md file (bersih, tanpa resource links)
    content_with_links: str  # isi lengkap dengan resource links
    position_in_roadmap: int # urutan kemunculan di roadmap (untuk ordering)


# ── Helpers ──────────────────────────────────────────────────────────────────

def clean_content(raw_md: str) -> str:
    """
    Bersihkan konten .md:
    - Hapus section "Visit the following resources"
    - Hapus resource links (@article, @video, @course, @feed)
    - Trim whitespace berlebih
    """
    lines = raw_md.split("\n")
    clean_lines = []
    skip = False
    for line in lines:
        stripped = line.strip()
        # Mulai skip saat ketemu section resources
        if stripped.lower().startswith("visit the following") or \
           stripped.lower().startswith("learn more:"):
            skip = True
            continue
        # Skip resource links
        if re.match(r"^- \[@(article|video|course|feed|official|roadmap)", stripped):
            continue
        if skip and stripped.startswith("- ["):
            continue
        # Resume kalau ada header baru setelah section resource
        if skip and stripped.startswith("#"):
            skip = False
        clean_lines.append(line)

    result = "\n".join(clean_lines)
    # Hapus multiple blank lines
    result = re.sub(r"\n{3,}", "\n\n", result)
    return result.strip()


def extract_urls(text: str) -> list[str]:
    """Ambil semua URL dari markdown link atau tulisan biasa."""
    url_pattern = re.compile(r"https?://[\w\-\.\/%#?=&@:+,;~]+", re.IGNORECASE)
    return url_pattern.findall(text)


class SimpleHTMLTextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text_parts = []
        self.skip = False
        self.skip_tags = {"script", "style", "noscript"}
        self.block_tags = {
            "p", "div", "br", "li", "section", "article",
            "header", "footer", "aside", "nav",
            "h1", "h2", "h3", "h4", "h5", "h6"
        }

    def handle_starttag(self, tag, attrs):
        if tag in self.skip_tags:
            self.skip = True
            return
        if tag in self.block_tags:
            self.text_parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.skip_tags:
            self.skip = False
            return
        if tag in self.block_tags:
            self.text_parts.append("\n")

    def handle_data(self, data):
        if self.skip:
            return
        self.text_parts.append(data)

    def handle_comment(self, data):
        pass

    def get_text(self):
        return unescape("".join(self.text_parts)).strip()


def fetch_url_text(url: str, timeout: int = 8) -> str:
    """Fetch URL dan ambil teks sederhana dari HTML."""
    headers = {"User-Agent": "Mozilla/5.0 (compatible; VerifyLearnBot/1.0)"}
    req = Request(url, headers=headers)
    try:
        with urlopen(req, timeout=timeout) as resp:
            if resp.headers.get_content_type() != "text/html":
                return ""
            raw_html = resp.read().decode(errors="ignore")
    except (HTTPError, URLError, socket.timeout, ConnectionResetError, ValueError):
        return ""
    except Exception:
        return ""

    parser = SimpleHTMLTextExtractor()
    parser.feed(raw_html)
    text = parser.get_text()
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    # Filter out known JS variable blocks and inline script leftovers.
    text = re.sub(r"window\.dataLayer\s*=\s*window\.dataLayer\s*\|\|\s*\[\];", "", text)
    text = re.sub(r"gtag\([^\)]*\);", "", text)
    text = re.sub(r"console\.warn\([^\)]*\);", "", text)
    text = re.sub(r"try \{[^\}]*\}\s*catch \([^\)]*\) \{[^\}]*\}", "", text, flags=re.DOTALL)
    text = re.sub(r"[\t ]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def summarize_url_text(text: str, max_chars: int = 1500) -> str:
    """Ringkas teks panjang menjadi potongan yang lebih pendek."""
    if not text:
        return ""

    text = text.replace("\r", "\n")
    chunks = [chunk.strip() for chunk in text.split("\n\n") if chunk.strip()]
    summary_parts = []
    total = 0
    for chunk in chunks:
        if total + len(chunk) > max_chars:
            break
        summary_parts.append(chunk)
        total += len(chunk)

    return "\n\n".join(summary_parts).strip()


def build_topic_hierarchy(nodes: list) -> dict:
    """
    Bangun mapping parent-child dari node list.
    Return: {node_id: parent_label}
    """
    # Kumpulkan semua topic nodes sebagai potential parents
    topic_nodes = {
        n["id"]: n.get("data", {}).get("label", "")
        for n in nodes
        if n.get("type") in ("topic",)
        and n.get("data", {}).get("label", "")
    }

    # Untuk subtopics, cari parent terdekat berdasarkan posisi Y
    # (roadmap.sh pakai koordinat XY untuk layout)
    parent_map = {}
    subtopic_nodes = [
        n for n in nodes
        if n.get("type") == "subtopic"
        and n.get("data", {}).get("label", "")
    ]

    for sub in subtopic_nodes:
        sub_y = sub.get("position", {}).get("y", 0)
        sub_x = sub.get("position", {}).get("x", 0)

        # Cari topic dengan Y paling dekat dan X lebih kiri (parent berada di atas/kiri)
        best_parent = ""
        best_dist = float("inf")
        for tid, tlabel in topic_nodes.items():
            t_node = next((n for n in nodes if n["id"] == tid), None)
            if not t_node:
                continue
            t_y = t_node.get("position", {}).get("y", 0)
            t_x = t_node.get("position", {}).get("x", 0)
            # Parent harus di atas atau setingkat, tidak terlalu jauh
            if t_y <= sub_y + 100:
                dist = abs(sub_x - t_x) + abs(sub_y - t_y)
                if dist < best_dist:
                    best_dist = dist
                    best_parent = tlabel

        parent_map[sub["id"]] = best_parent

    return parent_map


def extract_role_docs(
    roadmap_dir: str,
    role: str,
    json_filename: str,
) -> list[KnowledgeDoc]:
    """
    Ekstrak semua dokumen untuk satu role dari roadmap.sh.
    """
    base = Path(roadmap_dir) / role
    json_path = base / json_filename
    content_dir = base / "content"

    if not json_path.exists():
        print(f"  [SKIP] {json_path} tidak ditemukan")
        return []

    with open(json_path) as f:
        data = json.load(f)

    nodes = data.get("nodes", [])

    # Build content file map: node_id → {slug, filename}
    content_map = {}
    if content_dir.exists():
        for fn in os.listdir(content_dir):
            if not fn.endswith(".md"):
                continue
            parts = fn[:-3].rsplit("@", 1)
            if len(parts) == 2:
                slug, node_id = parts
                content_map[node_id] = {
                    "slug": slug,
                    "path": content_dir / fn
                }

    # Build parent hierarchy
    parent_map = build_topic_hierarchy(nodes)

    docs = []
    position = 0

    # Sorter nodes by Y position (roadmap flows top-to-bottom)
    def node_sort_key(n):
        pos = n.get("position", {})
        return (pos.get("y", 9999), pos.get("x", 9999))

    sorted_nodes = sorted(nodes, key=node_sort_key)

    for node in sorted_nodes:
        node_id = node.get("id", "")
        node_type = node.get("type", "")
        label = node.get("data", {}).get("label", "").strip()

        # Hanya proses topic dan subtopic yang punya label
        if node_type not in ("topic", "subtopic") or not label:
            continue

        # Skip node yang tidak punya content file
        if node_id not in content_map:
            continue

        content_info = content_map[node_id]
        raw_md = content_info["path"].read_text(encoding="utf-8")

        # Skip file yang isinya hanya resource links (konten tipis)
        if len(raw_md.strip()) < 50:
            continue

        clean = clean_content(raw_md)

        # Skip kalau setelah dibersihkan terlalu pendek
        if len(clean) < 30:
            continue

        parent = parent_map.get(node_id, "")

        # Normalisasi role: 'full-stack' → 'fullstack'
        role_norm = role.replace('-', '')

        # Gunakan position sebagai suffix untuk hindari duplikat
        base_id = f"{role_norm}::{content_info['slug']}"
        existing_ids = [d.doc_id for d in docs]
        doc_id = base_id if base_id not in existing_ids else f"{base_id}__{position}"

        url_summaries = []
        for url in extract_urls(raw_md):
            summary = fetch_url_text(url)
            if summary:
                trimmed = summarize_url_text(summary, max_chars=800)
                if trimmed:
                    url_summaries.append({"url": url, "summary": trimmed})

        expanded_content = clean
        if url_summaries:
            expanded_content += "\n\n" + "\n\n".join(
                f"Sumber: {item['url']}\n{item['summary']}"
                for item in url_summaries
            )

        doc = KnowledgeDoc(
            doc_id=doc_id,
            role=role_norm,
            topic_name=label,
            topic_type=node_type,
            parent_topic=parent,
            slug=content_info["slug"],
            content=clean,
            content_with_links=raw_md,
            position_in_roadmap=position,
        )
        doc.expanded_content = expanded_content
        docs.append(doc)
        position += 1

    return docs


def format_for_rag(doc: KnowledgeDoc) -> str:
    """
    Format dokumen menjadi teks yang optimal untuk embedding RAG.
    Tambahkan metadata sebagai prefix agar retrieval lebih akurat.
    """
    context_prefix = ""
    if doc.parent_topic:
        context_prefix = f"[Bagian dari: {doc.parent_topic}] "

    return f"""TOPIK: {doc.topic_name}
ROLE: {doc.role}
KATEGORI: {doc.topic_type}{f" | BAGIAN DARI: {doc.parent_topic}" if doc.parent_topic else ""}

{doc.content}"""


# ── Main extract pipeline ────────────────────────────────────────────────────

ROLE_CONFIG = {
    "backend": {
        "json": "backend.json",
        "display": "Backend Engineer",
    },
    "frontend": {
        "json": "frontend.json",
        "display": "Frontend Engineer",
    },
    "full-stack": {
        "json": "full-stack.json",
        "display": "Fullstack Engineer",
        "role_key": "fullstack",  # key yang dipakai di RAG
    },
}


def build_knowledge_base(roadmap_dir: str, output_dir: str) -> dict:
    """
    Ekstrak semua role dan simpan ke JSONL files.
    Return summary statistics.
    """
    os.makedirs(output_dir, exist_ok=True)
    summary = {}

    for role, config in ROLE_CONFIG.items():
        role_key = config.get("role_key", role)
        display = config["display"]

        print(f"\n{'─'*50}")
        print(f"Extracting: {display} (role_key={role_key})")

        docs = extract_role_docs(
            roadmap_dir=roadmap_dir,
            role=role,
            json_filename=config["json"],
        )

        if not docs:
            print(f"  [WARNING] Tidak ada dokumen diekstrak untuk {role}")
            continue

        # Simpan ke JSONL (satu doc per line)
        output_path = os.path.join(output_dir, f"{role_key}.jsonl")
        with open(output_path, "w", encoding="utf-8") as f:
            for doc in docs:
                d = asdict(doc)
                d["rag_text"] = format_for_rag(doc)  # field siap pakai untuk embedding
                f.write(json.dumps(d, ensure_ascii=False) + "\n")

        summary[role_key] = {
            "display_name": display,
            "total_docs": len(docs),
            "output_file": output_path,
            "topics": len([d for d in docs if d.topic_type == "topic"]),
            "subtopics": len([d for d in docs if d.topic_type == "subtopic"]),
            "avg_content_length": int(sum(len(d.content) for d in docs) / len(docs)),
        }

        print(f"  ✓ {len(docs)} docs → {output_path}")
        print(f"    Topics: {summary[role_key]['topics']}, "
              f"Subtopics: {summary[role_key]['subtopics']}, "
              f"Avg length: {summary[role_key]['avg_content_length']} chars")

        # Preview 5 topik pertama
        print("  Preview topik:")
        for doc in docs[:5]:
            print(f"    [{doc.topic_type:8s}] {doc.topic_name}")

    # Simpan summary
    summary_path = os.path.join(output_dir, "summary.json")
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    return summary


# ── Ingest ke ChromaDB ───────────────────────────────────────────────────────

def ingest_to_chromadb(kb_dir: str, api_key: str, db_dir: str):
    """Ingest semua JSONL knowledge base ke ChromaDB."""
    from services.rag.embedder import LocalEmbedder
    from services.rag.vectorstore import VectorStore

    print(f"\n{'='*50}")
    print("Ingesting ke ChromaDB...")
    print(f"{'='*50}")

    embedder = LocalEmbedder()
    vs = VectorStore(embedder=embedder, persist_dir=db_dir)

    for role_key in ["backend", "frontend", "fullstack"]:
        jsonl_path = os.path.join(kb_dir, f"{role_key}.jsonl")
        if not os.path.exists(jsonl_path):
            print(f"  [SKIP] {jsonl_path} tidak ada")
            continue

        # Baca semua docs
        docs = []
        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                docs.append(json.loads(line.strip()))

        print(f"\n[{role_key}] {len(docs)} dokumen...")

        # Ingest ke ChromaDB langsung dari doc_id + rag_text
        import chromadb
        from chromadb.config import Settings
        import hashlib

        collection = vs.collection
        batch_size = 10  # kecil untuk hindari rate limit free tier

        for i in range(0, len(docs), batch_size):
            batch = docs[i:i+batch_size]

            # Filter yang sudah ada
            new_batch = []
            for doc in batch:
                existing = collection.get(ids=[doc["doc_id"]])
                if not existing["ids"]:
                    new_batch.append(doc)

            if not new_batch:
                print(f"  Batch {i//batch_size + 1}: semua sudah ada, skip")
                continue

            print(f"  Embedding batch {i//batch_size + 1}/{(len(docs)-1)//batch_size + 1} "
                  f"({len(new_batch)} docs baru)...")

            embeddings = embedder.embed_documents_batch(
                [d["rag_text"] for d in new_batch],
                delay=0.3
            )

            collection.add(
                ids=[d["doc_id"] for d in new_batch],
                embeddings=embeddings,
                documents=[d["rag_text"] for d in new_batch],
                metadatas=[{
                    "role": d["role"],
                    "topic_name": d["topic_name"],
                    "topic_type": d["topic_type"],
                    "parent_topic": d["parent_topic"],
                    "slug": d["slug"],
                    "position": d["position_in_roadmap"],
                } for d in new_batch],
            )
            time.sleep(0.5)  # jeda antar batch

        print(f"  ✓ [{role_key}] selesai")

    print(f"\n✓ Total dokumen di ChromaDB: {vs.count()}")


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Build VerifyLearn knowledge base dari roadmap.sh"
    )
    parser.add_argument(
        "--roadmap-dir",
        default="/home/claude/roadmap-source/src/data/roadmaps",
        help="Path ke folder roadmaps dari developer-roadmap repo"
    )
    parser.add_argument(
        "--output-dir",
        default=os.path.join(BASE_DIR, "data/knowledge_base"),
        help="Folder output untuk JSONL files"
    )
    parser.add_argument(
        "--ingest",
        action="store_true",
        help="Langsung ingest ke ChromaDB setelah extract"
    )
    parser.add_argument(
        "--api-key",
        help="Gemini API key (wajib jika --ingest)"
    )
    parser.add_argument(
        "--db-dir",
        default=os.path.join(BASE_DIR, "chroma_db"),
        help="Direktori ChromaDB"
    )
    args = parser.parse_args()

    if args.ingest:
        pass  # api_key tidak diperlukan — embedder berjalan lokal

    print("=" * 50)
    print("  VerifyLearn — Knowledge Base Builder")
    print("=" * 50)
    print(f"  Roadmap dir : {args.roadmap_dir}")
    print(f"  Output dir  : {args.output_dir}")

    # Step 1: Extract
    summary = build_knowledge_base(args.roadmap_dir, args.output_dir)

    # Print summary
    print(f"\n{'='*50}")
    print("  SUMMARY")
    print(f"{'='*50}")
    total_docs = 0
    for role_key, stats in summary.items():
        print(f"  {stats['display_name']:25s}: {stats['total_docs']:3d} docs "
              f"({stats['topics']} topics, {stats['subtopics']} subtopics)")
        total_docs += stats["total_docs"]
    print(f"  {'TOTAL':25s}: {total_docs} docs")
    print(f"  Summary saved: {args.output_dir}/summary.json")

    # Step 2: Ingest (opsional)
    if args.ingest:
        ingest_to_chromadb(args.output_dir, args.api_key, args.db_dir)

    print(f"\n✓ Selesai!")
    if not args.ingest:
        print(f"\nLangkah berikutnya:")
        print(f"  python build_knowledge_base.py --roadmap-dir {args.roadmap_dir} \\")
        print(f"    --ingest --api-key YOUR_GEMINI_KEY")


if __name__ == "__main__":
    main()