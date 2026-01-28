from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from fastapi import HTTPException

from src import get_supported_formats as pac_get_supported_formats
from src import is_supported_format as pac_is_supported_format

from .config import DEFAULT_PROVIDER, get_out_dir, latest_by_mtime

logger = logging.getLogger("chunking.file_utils")

# ---------------------------------------------------------------------------
# Supported formats from PolicyAsCode
# ---------------------------------------------------------------------------

# Cache the formats dict from PaC
_formats_cache: dict | None = None


def get_supported_formats() -> dict:
    """Get supported document formats from PolicyAsCode.

    Returns:
        Dict with 'extensions', 'categories', and 'mime_types' keys.
    """
    global _formats_cache
    if _formats_cache is None:
        _formats_cache = pac_get_supported_formats()
    return _formats_cache


def get_file_extension(filename: str) -> str:
    """Extract and normalize the file extension from a filename.

    Args:
        filename: The filename to extract extension from.

    Returns:
        Lowercase extension including the dot (e.g., ".pdf"), or empty string if none.
    """
    if not filename:
        return ""
    dot_idx = filename.rfind(".")
    if dot_idx == -1:
        return ""
    return filename[dot_idx:].lower()


def get_file_type(filename: str) -> Optional[str]:
    """Determine the document type category from a filename.

    Args:
        filename: The filename to check.

    Returns:
        One of "pdf", "image", or "office" if supported, None otherwise.
    """
    ext = get_file_extension(filename)
    formats = get_supported_formats()
    categories = formats.get("categories", {})

    for cat, exts in categories.items():
        if ext in exts:
            return cat
    return None


def is_supported_format(filename: str) -> bool:
    """Check if a filename has a supported document extension.

    Args:
        filename: The filename to check.

    Returns:
        True if the extension is supported.
    """
    return pac_is_supported_format(filename)


def format_supported_extensions() -> str:
    """Format the list of supported extensions for error messages.

    Returns:
        Human-readable string listing all supported extensions.
    """
    formats = get_supported_formats()
    return ", ".join(sorted(formats.get("extensions", [])))


def get_accept_attribute() -> str:
    """Get the HTML accept attribute value for file inputs.

    Returns:
        Comma-separated string of extensions and MIME types for HTML accept attribute.
    """
    formats = get_supported_formats()
    parts = list(formats.get("extensions", []))
    for mimes in formats.get("mime_types", {}).values():
        parts.extend(mimes)
    return ",".join(sorted(set(parts)))


# ---------------------------------------------------------------------------
# Slug/path resolution
# ---------------------------------------------------------------------------


def resolve_slug_file(slug: str, pattern: str, provider: str = DEFAULT_PROVIDER) -> Path:
    out_dir = get_out_dir(provider)
    pat = pattern.format(slug=slug)
    if ".pages*" in pat and ".pages" in slug:
        pat = pat.replace(".pages*", "")
    candidates = sorted(out_dir.glob(pat))
    path = latest_by_mtime(candidates)
    if not path:
        raise HTTPException(status_code=404, detail=f"No file found for {slug} with pattern {pattern} (provider={provider})")
    return path
