# Phase 21 Brainstorm — Incremental Export + Deduplication

**Phase:** 21
**Owner:** TBD
**Date:** 2026-04-30

## Goal (1–2 sentences)
Allow repeated runs against the same chat history without duplicating messages, in a streaming-safe way.

## In Scope
- A CLI contract to deduplicate against an existing unified export (likely JSON).
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
- Candidate flags (to finalize):
  - `--dedup-against <path>` (existing unified JSON export)
  - Or `--dedup-index <path>` (optional persistent on-disk index)
- Decide behavior when prior export is chunked (directory input?).

## Data Model / Schema Touchpoints
- Depends on stability of `message_id` generation per adapter.

## Approach (High Level)
- Preferred: build an on-disk index of seen `message_id`s (SQLite or a simple KV file).
  - Pass 1: stream prior export(s) and insert message_ids.
  - Pass 2: stream current adapter output and drop messages whose IDs exist.
- Avoid in-memory sets.

## Edge Cases
- `message_id` collisions on flat-file adapters (hash-based): document assumptions.
- When the prior export was scrubbed/anonymized: should not matter (dedup on `message_id`).

## Test Plan
- Synthetic fixture where the new export contains a subset + new messages.
- Assert only net-new messages are written.

## Open Questions
- Should dedup happen before or after scrubbing filters?
- Should we emit stats (dropped count) to stderr (not output file)?

## Done When
- CLI can run twice without duplication and tests pass.
