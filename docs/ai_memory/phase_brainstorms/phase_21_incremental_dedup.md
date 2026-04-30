# Phase 21 Brainstorm — Incremental Export + Deduplication

**Phase:** 21
**Owner:** TBD
**Date:** 2026-04-30

## Goal (1–2 sentences)
Allow repeated runs against the same chat history without duplicating messages, in a streaming-safe way.

## In Scope
- A CLI contract to deduplicate against an existing unified export (JSON file or directory of JSON chunk files).
- Streaming-safe dedup implementation that scales to very large exports.
- Smoke tests proving stable behavior.

## Out of Scope
- Cross-chat merging / multi-input aggregation.
- Dedup against external databases (vector DB, etc.).

## Constraints (Non-Negotiables)
- Must not load prior export `messages[]` into memory.
- Must not require network.
- Must preserve message stream order.

## CLI Contract
### Flags (locked)
- `--dedup-against <path>`
  - When provided, the exporter will drop messages whose `message_id` already exists in the prior unified export(s).
  - `<path>` may be:
    - A unified export JSON file (single wrapper with `messages[]`), or
    - A directory containing unified export JSON files (e.g., Phase 20 chunked outputs).

### File vs directory semantics
- If `<path>` is a file:
  - Must be a unified export JSON wrapper produced by this tool.
- If `<path>` is a directory:
  - Dedup scans `*.json` files in that directory (non-recursive) in a stable, sorted order.
  - Non-JSON files are ignored.

### Output semantics (important)
Deduplication produces a **delta export** (net-new messages only). It does not append/merge into the prior export.

Implication with Phase 20 chunking:
- If you run chunked output into the same directory repeatedly, filenames will collide by chunk key (month/day).
- Recommended workflow: treat `--dedup-against` as the "archive" and write new deltas to a new output file/dir per run.

### Stats / logging
- When `--dedup-against` is enabled, emit a small summary to stderr:
  - prior IDs indexed
  - messages dropped (already-seen)
  - messages emitted (net-new)

## Data Model / Schema Touchpoints
- Depends on stability of `message_id` generation per adapter.

Notes:
- Dedup keys off `message_id` only.
- If an adapter’s `message_id` is hash-based and its hash inputs change (e.g., edits that change exported content), dedup may treat the message as new.

## Approach (High Level)
Preferred: build an **on-disk SQLite index** of seen `message_id`s per run.

### Pipeline placement (locked)
Apply dedup **before scrubbing**.

Rationale:
- Scrub transforms do not change `message_id`, so dedup correctness is unaffected.
- Dedup early avoids wasting work anonymizing/formatting messages that will be dropped.

### Two-pass streaming design
1. **Index prior export(s)**
   - Stream parse `message_id` values from `--dedup-against` JSON file(s).
   - Insert into SQLite table `seen(message_id TEXT PRIMARY KEY) WITHOUT ROWID`.
   - No in-memory set.
2. **Filter current run**
   - While streaming messages from the adapter, for each message:
     - If `message_id` exists in `seen`, drop it.
     - Else, emit it.

### SQLite implementation notes
- Use a temp on-disk DB (e.g., in `tmpdir()`), so memory stays bounded.
- Use prepared statements for speed:
  - `INSERT OR IGNORE INTO seen(message_id) VALUES (?1)`
  - `SELECT 1 FROM seen WHERE message_id = ?1 LIMIT 1`
- Consider pragmas for speed (while still safe): `journal_mode=WAL`, `synchronous=NORMAL`.

## Edge Cases
- `message_id` collisions on flat-file adapters (hash-based): document assumptions.
- When the prior export was scrubbed/anonymized: should not matter (dedup on `message_id`).

Additional:
- Prior export is chunked (`--dedup-against` is directory): ensure stable ordering and ignore non-JSON files.
- Prior export contains duplicate `message_id`s (should not happen, but possible): SQLite PK naturally de-dupes.
- If `--dedup-against` points at a huge directory: scanning many files is still streaming-safe; runtime cost is expected.

## Test Plan
Add a smoke test that:
1. Produces a baseline unified JSON export file from a small fixture.
2. Runs convert again with `--dedup-against <baseline.json>` and asserts the output contains fewer (or zero) messages.

Add a second smoke test variant for directory input:
- Create a directory with 2 chunk files (or reuse Phase 20 chunk output dir), and dedup against that directory.

## Open Questions
Decide later (not required to implement core dedup):
- Should `--dedup-against` scan directories recursively?
- Should we add a persistent `--dedup-index <path>` mode to avoid re-indexing huge archives each run?
- Should out-of-order timestamps matter for dedup? (Probably not; dedup ignores time.)

## Done When
- CLI can run repeatedly with `--dedup-against` producing a net-new delta export.
- Dedup is streaming-safe and does not buffer `messages[]`.
- Smoke tests pass.
