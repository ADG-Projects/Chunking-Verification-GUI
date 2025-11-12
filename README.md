# ChunkingTests

Local playground for document ingestion experiments. The first iteration focuses on using the open-source Unstructured library to break PDFs into structured JSON.

Two helper scripts exist today:
- `process_unstructured.py`: interactive full-document runs (see below).
- `scripts/preview_unstructured_pages.py`: fast page slicing + gold-table matching for targeted QA.

## Prerequisites

- macOS or Linux with Python 3.10+.
- [uv](https://github.com/astral-sh/uv) for dependency management (already expected in this repo).

## Setup

```bash
uv sync
```

`uv sync` creates a `.venv` in the project root and installs all required packages, including `unstructured[pdf]`.

## Process a PDF

```bash
uv run python process_unstructured.py
```

The script:
- Lists PDFs from `res/`.
- Prompts you to pick a file.
- Offers an optional toggle to limit how many pages are processed (handy for quick spot checks).
- Writes a structured JSON export to `outputs/<pdf-name>.json`.

Each JSON document includes the source path, timestamp, optional page limit, element count, and the raw Unstructured element payloads.

## Preview specific pages & compare to gold tables

When you just need a few pages (or want to evaluate table extraction quality), use the preview helper:

```bash
uv run python scripts/preview_unstructured_pages.py \
  --input res/V3.0_Reviewed_translation_EN_full\ 4.pdf \
  --pages 4-6 \
  --only-tables \
  --output outputs/unstructured/V3_0_EN_4.pages4-6.tables.jsonl \
  --gold dataset/gold.jsonl \
  --emit-matches outputs/unstructured/V3_0_EN_4.matches.json
```

What it does:
- Trims the PDF to the requested pages and runs Unstructured once.
- Emits the resulting elements (tables-only if requested) with deterministic `chunk-*` IDs.
- Parses each `text_as_html` payload into rows and auto-matches them to the curated `dataset/gold.jsonl` tables (multi-chunk coverage supported).
- Writes a `matches.json` summary showing per-table metrics and an overall section:
  - Per-table: `coverage` (recall), `cohesion` (`1 / selected_chunk_count`), `chunker_f1` (harmonic mean), plus the selected elements and the best single chunk.
  - Overall: macro averages across tables (`avg_coverage`, `avg_cohesion`, `avg_chunker_f1`, `avg_selected_chunk_count`) and `micro_coverage` weighted by gold rows.
  - Note: `cohesion` on each selected element is the row-overlap similarity (with a light column-count penalty) and differs from the table-level `cohesion` metric reported alongside coverage.

Use `--input-jsonl` when you want to re-evaluate matches from a previously saved JSONL without reprocessing the PDF, and `--trimmed-out` if you want to keep the sliced PDF for debugging.

## Next ideas

- Evaluate additional ingestion pipelines (Azure AI Document Intelligence, AWS Textract, etc.) as new experiments land in this sandbox.

## Web UI (Chunking Visualizer)

Spin up a small local UI to inspect PDFs, table matching, and chunker performance without juggling multiple files.

Quickstart:

```bash
uv sync
uv run python web/serve.py
# then open http://127.0.0.1:8765/
```

What you get:
- PDF rendering of the trimmed slice (via `*.pagesX-Y.pdf`).
- Per-table cards with coverage, cohesion, F1, and chunk count.
- One-click highlighting of selected chunks on the PDF (or just the best chunk, via a toggle).
 - Highlight controls per table: "Highlight all" overlays all selected chunks; "Highlight best" shows just the single best chunk.
- Overall metrics bars and a small chart of F1 by table.
- Drilldown: click "Details" on any table to preview the extracted HTML table for the best chunk (and switch among all selected chunks).

Data sources used by the UI:
- `outputs/unstructured/<slug>.matches.json`
- `outputs/unstructured/<slug>.pagesX-Y.tables.jsonl`
- `outputs/unstructured/<slug>.pagesX-Y.pdf`

Endpoints (served by FastAPI):
- `GET /api/runs` — discover available runs under `outputs/unstructured/`.
- `GET /api/matches/{slug}` — load the matches JSON.
- `GET /api/tables/{slug}` — load and parse the tables JSONL.
- `GET /pdf/{slug}` — stream the trimmed PDF.
