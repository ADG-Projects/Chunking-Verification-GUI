# Data Notes

The project does not persist to a database yet. Instead, Unstructured parses each PDF into JSON documents stored under `outputs/`.

## Document JSON layout
- `source_file`: Absolute path to the processed PDF.
- `generated_at`: ISO-8601 timestamp (UTC) for the run that created the JSON.
- `page_limit`: Page cap applied during extraction (null when all pages are included).
- `element_count`: Number of Unstructured elements returned.
- `elements`: Native `unstructured` element payloads serialized via `element.to_dict()`.

## Preview/Match artifacts

`scripts/preview_unstructured_pages.py` produces two additional files per run:

1. **Tables JSONL** (`outputs/unstructured/<doc>.pages<range>.tables.jsonl`)
   - Each line is a single Unstructured element with a deterministic `chunk-*` `element_id`.
   - `metadata.original_element_id` retains the vendor-provided ID for traceability.
   - The rest of the payload mirrors `element.to_dict()`.

2. **Matches JSON** (`outputs/unstructured/<doc>.matches.json`)
   - `matches`: array containing one entry per gold table:
     - `doc_id`, `gold_table_id`, `gold_title`, `gold_pages`, `expected_cols`
     - `selected_elements`: ordered list of chunks chosen to cover the gold rows (with trimmed/original page numbers plus individual scores).
     - `coverage_ratio`: proportion of unique left-column terms from the gold table found across the selected elements.
     - `best_element_id`, `best_page_trimmed`, `best_page_original`, `best_score`, `best_row_overlap`: convenience fields for the single best chunk.
