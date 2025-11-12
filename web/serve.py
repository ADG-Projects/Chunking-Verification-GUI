from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "outputs" / "unstructured"
DATASET_DIR = ROOT / "dataset"
VENDOR_DIR = ROOT / "web" / "static" / "vendor" / "pdfjs"
PDFJS_VERSION = "3.11.174"


app = FastAPI(title="Chunking Visualizer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)


def _latest_by_mtime(paths: List[Path]) -> Optional[Path]:
    if not paths:
        return None
    return max(paths, key=lambda p: p.stat().st_mtime)


def _slug_from_matches(p: Path) -> str:
    # <slug>.matches.json
    name = p.name
    if name.endswith(".matches.json"):
        return name[: -len(".matches.json")]
    return p.stem


def discover_runs() -> List[Dict[str, Any]]:
    runs: List[Dict[str, Any]] = []
    if not OUT_DIR.exists():
        return runs

    for m in sorted(OUT_DIR.glob("*.matches.json")):
        slug = _slug_from_matches(m)

        tables = sorted(OUT_DIR.glob(f"{slug}.pages*.tables.jsonl"))
        pdfs = sorted(OUT_DIR.glob(f"{slug}.pages*.pdf"))

        tables_path = _latest_by_mtime(tables)
        pdf_path = _latest_by_mtime(pdfs)

        # Parse page range if present
        page_range: Optional[str] = None
        if tables_path:
            m_pages = re.search(r"\.pages([0-9]+-[0-9]+)\.", tables_path.name)
            if m_pages:
                page_range = m_pages.group(1)

        with m.open("r", encoding="utf-8") as f:
            matches_json = json.load(f)

        overall = matches_json.get("overall", {})

        runs.append(
            {
                "slug": slug,
                "matches_file": str(m.relative_to(ROOT)),
                "tables_file": str(tables_path.relative_to(ROOT)) if tables_path else None,
                "pdf_file": str(pdf_path.relative_to(ROOT)) if pdf_path else None,
                "page_range": page_range,
                "overall": overall,
            }
        )

    return runs


@app.get("/api/runs")
def api_runs() -> List[Dict[str, Any]]:
    return discover_runs()


def _resolve_slug_file(slug: str, pattern: str) -> Path:
    # Find latest file matching pattern for slug
    candidates = sorted(OUT_DIR.glob(pattern.format(slug=slug)))
    path = _latest_by_mtime(candidates)
    if not path:
        raise HTTPException(status_code=404, detail=f"No file found for {slug} with pattern {pattern}")
    return path


@app.get("/api/matches/{slug}")
def api_matches(slug: str) -> Dict[str, Any]:
    path = OUT_DIR / f"{slug}.matches.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Matches not found for {slug}")
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


@app.get("/api/tables/{slug}")
def api_tables(slug: str) -> List[Dict[str, Any]]:
    path = _resolve_slug_file(slug, "{slug}.pages*.tables.jsonl")
    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                # Skip malformed lines gracefully
                continue
    return rows


# --- Minimal box index for faster UI loading ---
_INDEX_CACHE: Dict[str, Dict[str, Any]] = {}


def _ensure_index(slug: str) -> Dict[str, Any]:
    path = _resolve_slug_file(slug, "{slug}.pages*.tables.jsonl")
    mtime = path.stat().st_mtime
    cached = _INDEX_CACHE.get(slug)
    if cached and cached.get("mtime") == mtime and cached.get("path") == path:
        return cached

    by_id: Dict[str, Dict[str, Any]] = {}
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            element_id = obj.get("element_id")
            md = obj.get("metadata", {})
            coords = (md.get("coordinates") or {})
            pts = coords.get("points") or []
            if not element_id or not pts:
                continue
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            x = min(xs)
            y = min(ys)
            w = max(xs) - x
            h = max(ys) - y
            by_id[element_id] = {
                "page_trimmed": obj.get("page_number"),
                "layout_w": coords.get("layout_width"),
                "layout_h": coords.get("layout_height"),
                "x": x,
                "y": y,
                "w": w,
                "h": h,
            }

    cached = {"mtime": mtime, "path": path, "by_id": by_id}
    _INDEX_CACHE[slug] = cached
    return cached


@app.get("/api/elements/{slug}")
def api_elements(slug: str, ids: str = Query(..., description="Comma-separated element IDs")) -> Dict[str, Any]:
    wanted = [s for s in (ids or "").split(",") if s]
    idx = _ensure_index(slug)["by_id"]
    return {i: idx.get(i) for i in wanted if i in idx}


def _scan_element(slug: str, element_id: str) -> Optional[Dict[str, Any]]:
    path = _resolve_slug_file(slug, "{slug}.pages*.tables.jsonl")
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("element_id") == element_id:
                return obj
    return None


@app.get("/api/element/{slug}/{element_id}")
def api_element(slug: str, element_id: str) -> Dict[str, Any]:
    obj = _scan_element(slug, element_id)
    if not obj:
        raise HTTPException(status_code=404, detail=f"Element {element_id} not found")
    # Return a trimmed payload focused on preview
    md = obj.get("metadata", {})
    return {
        "element_id": obj.get("element_id"),
        "type": obj.get("type"),
        "page_number": obj.get("page_number"),
        "text": obj.get("text"),
        "text_as_html": md.get("text_as_html"),
        "expected_cols": md.get("expected_cols"),
        "coordinates": (md.get("coordinates") or {}),
        "original_element_id": md.get("original_element_id"),
    }


@app.get("/api/gold")
def api_gold() -> List[Dict[str, Any]]:
    gold_path = DATASET_DIR / "gold.jsonl"
    if not gold_path.exists():
        raise HTTPException(status_code=404, detail="gold.jsonl not found")
    rows: List[Dict[str, Any]] = []
    with gold_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


@app.get("/pdf/{slug}")
def pdf_for_slug(slug: str):
    pdf_path = _resolve_slug_file(slug, "{slug}.pages*.pdf")
    return FileResponse(str(pdf_path))


# Static UI (mounted last so API routes take precedence)
STATIC_DIR = ROOT / "web" / "static"
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="ui")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765, reload=False)
# Ensure local pdf.js assets are available so the UI can load without CDNs
def ensure_pdfjs_assets() -> None:
    VENDOR_DIR.mkdir(parents=True, exist_ok=True)
    files = ["pdf.min.js", "pdf.worker.min.js"]
    sources = [
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@{ver}/build/{name}",
        "https://unpkg.com/pdfjs-dist@{ver}/build/{name}",
    ]
    for fname in files:
        dest = VENDOR_DIR / fname
        if dest.exists() and dest.stat().st_size > 50_000:
            continue
        for tmpl in sources:
            url = tmpl.format(ver=PDFJS_VERSION, name=fname)
            try:
                with urlopen(url, timeout=10) as r:  # nosec - controlled URL
                    data = r.read()
                if not data:
                    continue
                with dest.open("wb") as f:
                    f.write(data)
                break
            except URLError:
                continue


ensure_pdfjs_assets()
