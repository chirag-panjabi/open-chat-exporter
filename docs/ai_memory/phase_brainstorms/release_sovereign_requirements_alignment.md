# Release Brainstorm — Sovereign Handoff Requirements Alignment (Non-Authoritative)

**Owner:** TBD
**Date:** 2026-04-30
**Source:** Sovereign project handoff doc (external input; not a source of truth for this repo)

## Goal
Map Sovereign’s expectations to the current Open Chat Exporter capabilities and decide what to adopt for broad usability.

## What We Already Meet (Today)
- **Local-first by default:** All offline adapters run locally. (Meta Conversations API adapter is explicitly optional.)
- **Streaming-first / large file posture:** Adapters yield `IUnifiedMessage` via async generators; writers stream outputs; no buffering `messages[]`.
- **Dual usage direction:** SDK/dependency mode is explicitly planned (Release Readiness R5).
- **MVP adapters (and more):** WhatsApp TXT, Discord JSON, Telegram JSON, iMessage SQLite (`chat.db`), plus many additional platforms.
- **Processing pipeline:** Streaming scrub stage supports identities resolution + optional anonymization, time-boxing, dropping system messages, and min content length.
- **Output formats:** JSON, Markdown, CSV (streaming writers). Chunking and incremental dedup supported.
- **Media handling:** Media excluded in V1; only `metadata.has_attachment` is set.

## Mismatches / Gaps vs Sovereign Doc
1. **Schema mismatch:** Sovereign doc describes a minimal per-message schema + JSON array output.
   - Our source-of-truth schema is a wrapper export (`export_meta`, `chat_info`, `messages[]`) with richer per-message structure.
2. **Packaging for non-technical users:** We are currently a Bun-run CLI.
   - Need a shipped executable and/or an embeddable library API that does not require end users to install Bun/Node.
3. **Fault tolerance:** Some adapters throw on malformed timestamps/lines.
   - Sovereign expects “warn + skip/best-effort” without crashing mid-file.
4. **Auditable logging/reporting:** We currently print some stats (e.g., dedup summary), but lack a unified optional report.

## Decisions to Brainstorm (Adopt / Don’t Adopt)
### Likely to Adopt (Broadly Useful)
- **R5 SDK API:** Stable programmatic API that mirrors CLI flags but avoids `process.exit`.
- **Binary distribution path:** A documented build + bundling strategy for a “silent background” runner.
- **Lenient parsing mode:** Add a global `--lenient` (or `--strict/--lenient`) to prefer warnings over fatal errors for parse issues.
- **Structured reporting:** Add `--report` (human) and/or `--report-json` output summarizing: parsed messages, dropped system, anonymized counts, etc.
- **Logging controls:** `--quiet` and `--log-format jsonl` for embedding into apps.

### Likely NOT to Adopt (Or Keep Optional)
- **Replace the unified schema:** Keep `03_unified_schema_definition.md` as authoritative; don’t downgrade core schema to a minimal per-message shape.
- **Network requirements:** Keep any online adapters strictly optional/off by default.

## Proposal: “Output Profile” Without Changing Unified Schema
- Add an optional output mode that matches Sovereign’s minimal schema without changing the canonical unified export.
- Example: `--output-profile minimal` (or `--output-format sovereign-json`) emitting a JSON array of `{ platform, timestamp_utc, sender_name, message_content }`.
- This keeps the unified schema as the durable internal contract while supporting strict downstream consumers.

## Done When
- We can articulate a clear “what’s canonical” vs “what’s a profile” story.
- We have a prioritized release plan for packaging + SDK + lenient parsing + reporting.
