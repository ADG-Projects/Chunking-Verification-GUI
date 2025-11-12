#!/usr/bin/env python
"""Interactive PDF processor powered by the Unstructured library."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import List

from unstructured.partition.pdf import partition_pdf


PDF_DIR = Path(__file__).parent / "res"
OUTPUT_DIR = Path(__file__).parent / "outputs"


def discover_pdfs() -> List[Path]:
    """Return a sorted list of PDFs inside the resource directory."""
    return sorted(PDF_DIR.glob("*.pdf"))


def pick_pdf(pdfs: List[Path]) -> Path:
    """Prompt the user to pick a PDF by index."""
    print("Available PDFs:")
    for idx, pdf in enumerate(pdfs, start=1):
        print(f"  {idx}. {pdf.name}")

    while True:
        selection = input(f"Select a document [1-{len(pdfs)}]: ").strip()
        if not selection.isdigit():
            print("Please enter a numeric choice.")
            continue

        choice = int(selection)
        if 1 <= choice <= len(pdfs):
            return pdfs[choice - 1]

        print("Choice out of range, try again.")


def prompt_page_limit() -> int | None:
    """Ask whether to cap the number of processed pages and return the cap."""
    while True:
        answer = input("Limit processed pages? [y/N]: ").strip().lower()
        if answer in {"", "n", "no"}:
            return None
        if answer in {"y", "yes"}:
            break
        print("Please respond with 'y' or 'n'.")

    while True:
        limit_raw = input("Maximum number of pages to process: ").strip()
        if not limit_raw.isdigit():
            print("Enter a positive integer.")
            continue

        limit = int(limit_raw)
        if limit > 0:
            return limit

        print("Value must be greater than zero.")


def main() -> None:
    if not PDF_DIR.exists():
        raise SystemExit(f"PDF directory not found: {PDF_DIR}")

    pdfs = discover_pdfs()
    if not pdfs:
        raise SystemExit(f"No PDF files found inside {PDF_DIR}.")

    target_pdf = pick_pdf(pdfs)
    page_limit = prompt_page_limit()

    pages = None
    if page_limit is not None:
        pages = list(range(1, page_limit + 1))
        print(f"Processing first {page_limit} pages of {target_pdf.name}...")
    else:
        print(f"Processing all pages of {target_pdf.name}...")

    OUTPUT_DIR.mkdir(exist_ok=True)

    elements = partition_pdf(filename=str(target_pdf), pages=pages)

    output_payload = {
        "source_file": str(target_pdf.resolve()),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "page_limit": page_limit,
        "element_count": len(elements),
        "elements": [element.to_dict() for element in elements],
    }

    target_json = OUTPUT_DIR / f"{target_pdf.stem}.json"
    with target_json.open("w", encoding="utf-8") as f:
        json.dump(output_payload, f, ensure_ascii=False, indent=2)

    print(f"Wrote {target_json}")


if __name__ == "__main__":
    main()
