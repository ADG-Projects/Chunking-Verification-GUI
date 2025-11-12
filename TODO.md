# TODO

## Upcoming
- [ ] Compare output quality between Unstructured and the Azure Document Intelligence SDK.

## Completed
- [x] 2025-11-12 Replace global highlight toggle with per-table buttons (Highlight all / Highlight best) for clearer intent.
- [x] 2025-11-12 Add per-chunk contribution display in Details (coverage, cohesion impact, solo-F1 vs table F1) and tags on chips.
- [x] 2025-11-12 Add drilldown UI to preview extracted Unstructured table HTML per chunk (best + selected).
- [x] 2025-11-12 Optimize web UI load time: lazy-fetch element boxes, cache minimal index server-side, and enable PDF.js worker.
- [x] 2025-11-12 Add web UI to visualize PDFs, table matches, and chunker performance (FastAPI + static UI).
- [x] 2025-11-12 Rename per-element similarity metric outputs to `cohesion` for consistency.
- [x] 2025-11-12 Add explicit coverage/cohesion per table and overall summary to matches JSON.
- [x] 2025-11-12 Add F1-like `chunker_f1` metric to matches output for overall table chunking quality.
- [x] 2025-11-12 Auto-match Unstructured table slices to `dataset/gold.jsonl` via the preview script.
- [x] 2025-10-23 Document local Unstructured PDF processing with optional page cap.
