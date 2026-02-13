from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse

from ..config import DEFAULT_PROVIDER, RES_DIR, get_out_dir, latest_by_mtime, relative_to_root, sanitize_document_filename
from ..file_utils import (
    format_supported_extensions,
    get_file_type,
    get_supported_formats,
    is_supported_format,
    resolve_slug_file,
)

router = APIRouter()


@router.get("/api/supported-formats")
def api_supported_formats() -> Dict[str, Any]:
    """Get supported document formats from PolicyAsCode."""
    formats = get_supported_formats()
    return {
        "extensions": sorted(formats.get("extensions", [])),
        "categories": {cat: sorted(exts) for cat, exts in formats.get("categories", {}).items()},
        "mime_types": {cat: sorted(mimes) for cat, mimes in formats.get("mime_types", {}).items()},
    }


@router.get("/api/pdfs")
def api_pdfs() -> List[Dict[str, Any]]:
    """List all documents in the res directory (PDFs, Office docs, images)."""
    docs: List[Dict[str, Any]] = []
    if RES_DIR.exists():
        formats = get_supported_formats()
        extensions = formats.get("extensions", [])
        for p in sorted(RES_DIR.iterdir()):
            if not p.is_file():
                continue
            ext = p.suffix.lower()
            if ext not in extensions:
                continue
            try:
                size = p.stat().st_size
            except OSError:
                size = None
            docs.append(
                {
                    "name": p.name,
                    "slug": p.stem,
                    "path": relative_to_root(p),
                    "size": size,
                    "type": get_file_type(p.name),
                }
            )
    return docs


@router.post("/api/pdfs")
async def api_upload_document(file: UploadFile = File(...)) -> Dict[str, Any]:
    """Upload a document (PDF, Office doc, or image)."""
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="file is required")
    safe_name = sanitize_document_filename(file.filename)
    if not safe_name:
        supported = format_supported_extensions()
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Accepted formats: {supported}",
        )
    dest = (RES_DIR / safe_name).resolve()
    if not str(dest).startswith(str(RES_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid destination path")
    if dest.exists():
        raise HTTPException(status_code=409, detail=f"Document already exists: {safe_name}")
    try:
        with dest.open("wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
    finally:
        await file.close()
    try:
        size = dest.stat().st_size
    except OSError:
        size = None
    return {
        "name": safe_name,
        "slug": dest.stem,
        "path": relative_to_root(dest),
        "size": size,
        "type": get_file_type(safe_name),
    }


@router.delete("/api/pdfs/{name}")
def api_delete_document(name: str) -> Dict[str, Any]:
    """Delete a document from the res directory."""
    if not name or not is_supported_format(name):
        supported = format_supported_extensions()
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Accepted: {supported}")
    candidate = (RES_DIR / Path(name).name).resolve()
    if not str(candidate).startswith(str(RES_DIR.resolve())):
        raise HTTPException(status_code=400, detail="invalid path")
    if not candidate.exists():
        raise HTTPException(status_code=404, detail=f"Document not found: {name}")
    try:
        candidate.unlink()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete: {e}")
    return {"status": "ok", "removed": relative_to_root(candidate)}


@router.get("/res_pdf/{name}")
def document_from_res(name: str):
    """Serve a document from the res directory."""
    if not is_supported_format(name):
        supported = format_supported_extensions()
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Accepted: {supported}")
    candidate = (RES_DIR / name).resolve()
    if not str(candidate).startswith(str(RES_DIR.resolve())):
        raise HTTPException(status_code=400, detail="invalid path")
    if not candidate.exists():
        raise HTTPException(status_code=404, detail=f"Document not found: {name}")
    return FileResponse(str(candidate))


@router.get("/pdf/{slug}")
def pdf_for_slug(slug: str, provider: str = Query(default=None)):
    path = resolve_slug_file(slug, "{slug}.pages*.pdf", provider=provider or DEFAULT_PROVIDER)
    return FileResponse(str(path))


@router.api_route("/api/converted-pdf/{name}", methods=["GET", "HEAD"])
def get_converted_pdf(name: str, provider: str = Query(default=None)):
    """Check if a converted PDF exists for an Office document and return it.

    Looks for PDFs in the output directory matching the document's slug.
    Returns the most recent converted PDF if found.
    Supports both GET and HEAD requests.
    """
    # Extract slug from filename (remove extension)
    slug = Path(name).stem
    out_dir = get_out_dir(provider or DEFAULT_PROVIDER)

    # Look for converted PDFs matching this slug (including variant-tagged files like slug__r2.pages_.pdf)
    pattern = f"{slug}*.pages*.pdf"
    candidates = [p for p in out_dir.glob(pattern) if p.stat().st_size > 0]
    path = latest_by_mtime(candidates)

    if not path:
        raise HTTPException(status_code=404, detail=f"No converted PDF found for {name}")

    return FileResponse(str(path))
