"""API routes for chunker operations."""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

from fastapi import APIRouter, HTTPException, Request

from src.extractors.chunker_registry import chunker_schemas, get_chunker
from src.extractors.chunking_defaults import (
    CHARS_PER_TOKEN_BY_LANGUAGE,
    chars_per_token_for_language,
)
from src.extractors.section_based_chunker import (
    decode_orig_elements,
    get_chunk_statistics,
)
from src.models.elements import Element

from ..config import DEFAULT_PROVIDER, PROVIDERS, get_out_dir
from ..extraction_jobs import EXTRACTION_JOB_MANAGER

logger = logging.getLogger("chunking.routes.chunker")
router = APIRouter()


def _resolve_elements_or_chunks_file(slug: str, provider: str) -> Tuple[Path, bool]:
    """Find elements or chunks JSONL file for a given slug and provider.

    Returns (path, is_elements) where is_elements indicates file type.
    """
    out_dir = get_out_dir(provider)

    # Try elements file first (v5.0+)
    path = out_dir / f"{slug}.elements.jsonl"
    if path.exists():
        return path, True

    # Try with pages suffix pattern for elements
    base, sep, rest = slug.partition(".pages")
    if sep:
        candidate = out_dir / f"{base}.pages{rest}.elements.jsonl"
        if candidate.exists():
            return candidate, True

    # Fall back to chunks file (legacy pre-v5.0)
    path = out_dir / f"{slug}.chunks.jsonl"
    if path.exists():
        return path, False

    if sep:
        candidate = out_dir / f"{base}.pages{rest}.chunks.jsonl"
        if candidate.exists():
            return candidate, False

    raise HTTPException(status_code=404, detail=f"No elements or chunks file found for {slug}")


def _load_elements_from_elements_file(path: Path) -> List[Dict[str, Any]]:
    """Load elements from a v5.0+ elements JSONL file."""
    elements = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    elements.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return elements


def _load_elements_from_chunks_file(path: Path) -> List[Dict[str, Any]]:
    """Extract elements from a legacy chunks JSONL file.

    Handles two formats:
    1. Chunks with embedded orig_elements (Unstructured chunker output)
    2. Direct element-style chunks (Azure DI legacy output)
    """
    elements = []
    seen_ids: set = set()

    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                chunk = json.loads(line)
            except json.JSONDecodeError:
                continue

            meta = chunk.get("metadata") or {}

            # Try to decode orig_elements first (Unstructured chunker format)
            try:
                orig_elements = decode_orig_elements(meta)
            except Exception:
                orig_elements = []

            if orig_elements:
                # Extract embedded original elements
                for el in orig_elements:
                    element_id = el.get("element_id")
                    if element_id and element_id not in seen_ids:
                        seen_ids.add(element_id)
                        elements.append(el)
            else:
                # Treat chunk as a direct element (Azure DI legacy format)
                element_id = chunk.get("element_id")
                if element_id and element_id not in seen_ids:
                    seen_ids.add(element_id)
                    elements.append(chunk)

    return elements


def _load_extraction_metadata(slug: str, provider: str) -> Dict[str, Any]:
    """Load extraction.json metadata for a slug, returning {} on any failure."""
    out_dir = get_out_dir(provider)
    # Try direct match first, then pages-suffix variant
    candidates = [out_dir / f"{slug}.extraction.json"]
    base, sep, rest = slug.partition(".pages")
    if sep:
        candidates.append(out_dir / f"{base}.pages{rest}.extraction.json")
    for path in candidates:
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pass
    return {}


def _detect_language_code(meta: Dict[str, Any]) -> str | None:
    """Extract a 2-letter language code from extraction metadata.

    The metadata may contain language info in various shapes (Azure DI
    detected_languages list, form_snapshot primary_language, etc.).
    Returns a 2-letter ISO 639-1 code like 'ar' or 'en', or None.
    """
    # ISO 639-3 → ISO 639-1 mapping for languages in the chars_per_token map
    _3to2 = {"ara": "ar", "eng": "en", "arb": "ar"}

    def _norm(val: Any) -> str | None:
        if not val:
            return None
        txt = str(val).strip().lower()
        if not txt:
            return None
        # Already 2-letter?
        if txt in CHARS_PER_TOKEN_BY_LANGUAGE:
            return txt
        # 3-letter code?
        if txt in _3to2:
            return _3to2[txt]
        # Prefix match (e.g. 'ar-SA' → 'ar')
        prefix = txt[:2]
        if prefix in CHARS_PER_TOKEN_BY_LANGUAGE:
            return prefix
        return None

    def _extract_from_list(lst: Any) -> str | None:
        if not isinstance(lst, list):
            return None
        for item in lst:
            if isinstance(item, dict):
                code = _norm(
                    item.get("locale")
                    or item.get("language")
                    or item.get("language_code")
                    or item.get("code")
                )
            else:
                code = _norm(item)
            if code:
                return code
        return None

    snap = meta.get("form_snapshot") or {}
    # Try detected_primary_language first, then language lists
    for src in (meta, snap):
        code = _norm(src.get("detected_primary_language"))
        if code:
            return code
    for src in (meta, snap):
        code = _extract_from_list(src.get("detected_languages"))
        if code:
            return code
    for src in (snap, meta):
        code = _norm(src.get("primary_language"))
        if code:
            return code
    for src in (snap, meta):
        code = _norm(src.get("ocr_languages"))
        if code:
            return code
    return None


def _save_chunks(chunks: List[Any], path: Path) -> None:
    """Save chunks to a JSONL file."""
    with path.open("w", encoding="utf-8") as f:
        for chunk in chunks:
            # Convert Pydantic models to dicts if needed
            data = chunk.model_dump() if hasattr(chunk, "model_dump") else chunk
            f.write(json.dumps(data, ensure_ascii=False) + "\n")


@router.get("/api/chunkers")
async def api_chunkers() -> Dict[str, Any]:
    """Return available chunker strategies with their parameter schemas."""
    return {
        "chunkers": chunker_schemas(),
        "chars_per_token_by_language": CHARS_PER_TOKEN_BY_LANGUAGE,
    }


@router.post("/api/chunk")
async def api_chunk(request: Request) -> Dict[str, Any]:
    """Run a chunker strategy on an existing run's elements.

    Request body:
    {
        "source_slug": "...",       # Slug of the source run
        "source_provider": "...",   # Provider of the source run
        "chunker": "section_based",  # Chunker strategy name (default: "section_based")
        "config": { ... }           # Optional config overrides for the chosen chunker
    }

    Returns:
    {
        "success": true,
        "chunks_file": "...",
        "summary": {
            "count": ...,
            "total_chars": ...,
            ...
        }
    }
    """
    try:
        payload = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}") from e

    source_slug = payload.get("source_slug")
    if not source_slug:
        raise HTTPException(status_code=400, detail="source_slug is required")

    source_provider = payload.get("source_provider") or DEFAULT_PROVIDER
    if source_provider not in PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown provider: {source_provider}",
        )

    # Resolve chunker strategy from the registry
    chunker_name = payload.get("chunker") or "section_based"
    try:
        chunker_info = get_chunker(chunker_name)
    except KeyError:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown chunker strategy: {chunker_name}",
        )

    # Build config, with optional language-aware chars_per_token injection
    config_dict = payload.get("config") or {}
    detected_language = None
    applied_chars_per_token = None

    # Auto-inject chars_per_token if user didn't explicitly set it
    if "chars_per_token" not in config_dict:
        meta = _load_extraction_metadata(source_slug, source_provider)
        detected_language = _detect_language_code(meta)
        if detected_language:
            cpt = chars_per_token_for_language(detected_language)
            config_dict["chars_per_token"] = cpt
            applied_chars_per_token = cpt
            logger.info(
                f"Auto-set chars_per_token={cpt} for detected language '{detected_language}'"
            )

    try:
        config = chunker_info.config_model(**config_dict)
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid config for {chunker_name}: {e}",
        ) from e

    # Find and load source elements (supports both v5.0+ and legacy formats)
    try:
        source_path, is_elements = _resolve_elements_or_chunks_file(source_slug, source_provider)
    except HTTPException:
        raise HTTPException(
            status_code=404,
            detail=f"Source elements not found for {source_slug} ({source_provider})",
        )

    logger.info(f"Loading elements from {source_path} (is_elements={is_elements})")
    if is_elements:
        elements = _load_elements_from_elements_file(source_path)
    else:
        elements = _load_elements_from_chunks_file(source_path)

    if not elements:
        raise HTTPException(
            status_code=400,
            detail="Source file contains no elements",
        )

    logger.info(f"Loaded {len(elements)} elements, running {chunker_name} chunker")

    # Convert dicts to Element models (chunker functions expect Pydantic models)
    element_models = [Element.model_validate(el) for el in elements]

    # Run chunker
    chunks = chunker_info.chunker_fn(element_models, config)
    stats = get_chunk_statistics(chunks)
    summary = stats.model_dump()

    logger.info(
        f"Generated {summary['count']} chunks "
        f"(avg {summary['avg_chars']} chars)"
    )

    # Save chunks to output file
    # Output goes to same directory as source file, with .chunks.jsonl suffix
    out_dir = get_out_dir(source_provider)
    # Strip both .elements and .chunks suffixes from stem for output naming
    output_stem = source_path.stem.replace(".elements", "").replace(".chunks", "")
    output_path = out_dir / f"{output_stem}.chunks.jsonl"

    logger.info(f"Saving chunks to {output_path}")
    _save_chunks(chunks, output_path)

    result: Dict[str, Any] = {
        "success": True,
        "chunks_file": str(output_path),
        "source_elements": len(elements),
        "summary": summary,
    }
    if detected_language:
        result["detected_language"] = detected_language
    if applied_chars_per_token is not None:
        result["applied_chars_per_token"] = applied_chars_per_token
    return result
