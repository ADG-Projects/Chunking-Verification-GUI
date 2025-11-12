# Repository Guidelines

## Project Structure & Module Organization
Repository root keeps runnable helpers alongside documentation for fast iteration. `process_unstructured.py` handles full-PDF ingestion, while `scripts/preview_unstructured_pages.py` targets page slices and gold-table comparisons. PDF fixtures live in `res/`, curated references in `dataset/`, and generated artifacts in `outputs/` (use `outputs/unstructured/` for JSONL runs). `README.md`, `TODO.md`, and `database-schema.md` must move in lockstep with any new capability so contributors and evaluators stay aligned.

## Build, Test, and Development Commands
Install everything with `uv sync`; it resolves `unstructured[pdf]` and wires the local `.venv`. Run an end-to-end ingestion with `uv run python process_unstructured.py` for interactive PDF selection and JSON export into `outputs/`. Use targeted QA via `uv run python scripts/preview_unstructured_pages.py --input res/<pdf>.pdf --pages 4-6 --output outputs/unstructured/<slug>.jsonl --gold dataset/gold.jsonl` to slice pages and score chunk quality. Keep datasets small by pruning `outputs/` artifacts that are not needed in Git history.

## Coding Style & Naming Conventions
Stick to idiomatic Python 3.10+, 4-space indentation, and f-strings for any dynamic text (Loguru also expects them). Favor explicit helper functions over inlined comprehensions when parsing structured payloads. Keep filenames descriptive without “test” unless they are true test modules, and use snake_case for functions, UPPER_SNAKE_CASE for constants, and kebab-case for output JSON artifacts (e.g., `V3_0_EN_4.matches.json`).

## Testing Guidelines
Primary validation happens through the preview script: capture JSONL outputs and inspect the generated cohesion/coverage metrics before shipping changes. When modifying table parsing, compare against `dataset/gold.jsonl` using `--emit-matches outputs/unstructured/<slug>.matches.json` to spot regressions. Prefer crafting reproducible page slices over large PDFs so reviewers can run `uv run python scripts/preview_unstructured_pages.py --input-jsonl <file>` quickly.

## Commit & Pull Request Guidelines
Write imperative, scope-focused commits (e.g., “Add Unstructured preview helper”). Push incremental changes rather than a single mega-commit, and document noteworthy behavior in `TODO.md` (newest completed items first, timestamped). PRs should summarize motivation, detail command-level verification steps, and mention any dataset or schema tweaks. Include screenshots or metric diffs whenever output structure changes, and confirm no stray artifacts remain in `outputs/` before requesting review.
