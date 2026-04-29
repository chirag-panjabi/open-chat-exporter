# Phase 20 Brainstorm — Output Chunking (Time / Token Budget)

**Phase:** 20
**Owner:** TBD
**Date:** 2026-04-30

## Goal (1–2 sentences)
Make large exports usable by splitting outputs into multiple files without buffering all messages in memory.

## In Scope
- Time-based chunking for `--output-format json` and `md`.
- Deterministic chunk boundaries (e.g., by month or day) with stable filenames.
- Streaming-safe implementation (writers emit to one file at a time; switch files when boundary changes).
- Smoke tests proving chunking works and ordering is preserved.

## Out of Scope
- GUI/UI.
- True token-count chunking unless we can do it streaming-safe and deterministically (optional follow-up).

## Constraints (Non-Negotiables)
- Must not buffer `messages[]`.
- Must remain backpressure-safe.
- Must not introduce new PII risk (fixtures only).

## CLI Contract
- Likely flags (to be finalized):
  - `--chunk-by <none|day|month>` (default: `none`)
  - `--output <path>` becomes either directory or template
- Decide whether `--output` points to a directory when chunking.
- Backwards compatibility: existing single-file output must keep working.

## Data Model / Schema Touchpoints
- No schema changes required; chunking is an output-layer behavior.

## Approach (High Level)
- Add a chunking router stage after scrub filters and before writers.
- Keep current message stream, but write to a "current chunk" writer and rotate when `timestamp_utc` crosses boundary.
- JSON writer needs to emit a root wrapper per chunk.

## Edge Cases
- Messages out of order (some platforms may emit unsorted):
  - Decide whether to enforce chronological ordering (cannot sort without buffering).
  - Prefer: document that chunking assumes adapters emit chronological order.
- Timezone: chunking should use UTC boundaries (based on `timestamp_utc`).

## Test Plan
- Synthetic fixture with messages spanning two months; assert two output files produced.
- Verify each chunk file is valid JSON/MD and contains only its messages.

## Open Questions
- Do we want chunking for CSV too?
- Output naming convention (YYYY-MM, YYYY-MM-DD).

## Done When
- CLI supports time-based chunking, tests pass, docs updated.
