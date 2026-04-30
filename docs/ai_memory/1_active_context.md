# Active Context for AI Agents
**Last Updated:** April 30, 2026

## Project Identity
**Unified Chat Exporter (V1: TypeScript)**

## Current Phase: Release Readiness (V1)
Core functionality through Phase 22 is implemented; current work is packaging, documentation, and integration ergonomics.

We now have end-to-end conversion with streaming adapters and smoke tests for:
- Discord JSON (`DISCORD`)
- WhatsApp TXT (`WHATSAPP`)
- WhatsApp iOS `ChatStorage.sqlite` (`WHATSAPP`)
- WhatsApp Android decrypted msgstore-style SQLite (`WHATSAPP`)
- Telegram JSON (`TELEGRAM`)
- Slack JSON (`SLACK`)
- iMessage macOS Messages `chat.db` (`IMESSAGE`)
- Facebook Messenger JSON (`FB_MESSENGER`)
- Google Chat JSON (`GOOG_CHAT`)
- Instagram JSON (`INSTAGRAM`)
- Snapchat JSON (`SNAPCHAT`)
- LinkedIn Messages CSV (`LINKEDIN`)
- Microsoft Teams JSON (`MS_TEAMS`)
- X (Twitter) DMs (`X_TWITTER`)
- Skype messages JSON (`SKYPE`)

## Next High-Level Objectives
- [x] Pick the exact JavaScript/TypeScript runtime (Bun).
- [x] Initialize the project and setup the dependency structure.
- [x] Translate the JSON rules inside `03_unified_schema_definition.md` into strict TypeScript Interfaces inside a `src/types/` folder.
- [x] Build the abstract streaming engines and base Adapter logic.
- [x] Build the CLI Shell (`src/cli/index.ts`) for `convert`.
- [x] Write the first adapter POC (Discord JSON).
- [x] Write the WhatsApp `.txt` adapter (streaming, multiline-safe).
- [x] Write the Telegram `result.json` adapter (streaming, rich text flattening).
- [x] Write the Facebook Messenger adapter (streaming JSON over `messages[]`).
- [x] Write the Google Chat adapter (streaming JSON over `messages[]`).
- [x] Write the Instagram adapter (streaming JSON over `messages[]`).
- [x] Write the Snapchat adapter (streaming JSON `chat_history.json`).
- [x] Write the LinkedIn adapter (streaming CSV `messages.csv`).
- [x] Write the Slack adapter (streaming JSON over Slack channel message arrays).
- [x] Implement the next platform adapter (next up: iMessage).

## Recent Decisions Log:
- **Language:** TypeScript V1, Rust V2.
- **WhatsApp Strategy:** Tier 1 format (`.txt`) strips threaded replies. Placed `reply_to_message_id: null`. Tier 2 format (`.crypt15` SQL) handles real threads but requires user key extraction. Porting Python SQLite extraction logic from `KnugiHK/WhatsApp-Chat-Exporter` into TS rather than using native Python bindings.
- **iMessage Strategy (V1):** Target macOS Messages `chat.db` SQLite as the baseline input (most user-accessible), leaving iOS backup/device workflows for later.
- **WhatsApp Reply Strategy (Future):** The `.txt` export is insufficient for reply-to mapping. Add a DB-level WhatsApp import path (iOS backup / decrypted DB), inspired by tools like iMazing which extract WhatsApp data from iOS backups.
- **Meta Reply Strategy (Facebook/Instagram):** "Download Your Information" exports do not appear to consistently include reply pointers / stable message IDs, so `reply_to_message_id` will generally be `null` for offline Meta exports. Meta’s official Conversations API can expose `reply_to` for eligible Page/Instagram Professional account messaging, but it is gated (token/app setup) and has platform limits (notably, message detail access is limited to recent messages).
- **Meta API Adapter Contract (Draft):** If implemented, the Meta Conversations API adapter must take secrets via env vars (draft: `META_ACCESS_TOKEN`, optional `META_GRAPH_API_VERSION`) and accept a non-secret JSON config via `--input` containing only IDs/selection parameters.
- **Meta API Adapter Testing:** Smoke tests run in a zero-network fixture mode via `META_API_FIXTURE_DIR` so no real tokens or exports are required in CI.
- **Next Phase (Scrubbing + Outputs):** Implement a streaming scrub pipeline (identity resolution + optional anonymization + filters) and add Markdown/CSV writers behind `--output-format`.
- **Phase 20 (Output Chunking):** Chosen contract is **directory-mode** output when chunking is enabled. Filenames use a non-PII stable identifier: `<platform>.<chatId>.chunk.<chunkKey>.<ext>` where `chatId` is a short prefix of `sha256(platform + "\n" + chat_type + "\n" + chat_name)`. Collision policy is fail-fast by default, with `--overwrite` to replace existing chunk files.
- **SDK / Dependency Mode (Planned):** Keep the core pipeline usable as a library (stable programmatic API + package exports) so other products can embed parsing/normalization without re-implementing adapters.

## Current Status
- Phase 19 (Scrubbing + Markdown/CSV outputs) is implemented and covered by smoke tests.
- Phase 17 (WhatsApp reply-aware imports via DB) is implemented for iOS `ChatStorage.sqlite` and covered by a synthetic smoke test.
- Phase 22 (WhatsApp Android reply-aware DB) is implemented for decrypted msgstore-style SQLite (`messages` table) and covered by a synthetic smoke test.
- Phase 20 (Output chunking) is implemented for `json` and `md` via `--chunk-by` (directory-mode output), with fail-fast collision behavior by default and `--overwrite` available.
- Phase 21 (Incremental dedup) is implemented via `--dedup-against <file|dir>` (streaming-safe on-disk index; drops already-seen `message_id`s).
- Release readiness: structured run reporting is supported via `--report-json`, and best-effort parsing is supported for WhatsApp TXT via `--lenient` (warnings are aggregated and included in the report).

## Next Focus
- V1 core scope is implemented through Phase 22.
- Release readiness: packaging/distribution + README/docs (streaming-safe, no-PII).
- Integration ergonomics for host apps (e.g., Sovereign): output profiles (minimal JSON array), SDK/dependency entrypoint, and structured reporting/logging.
- Next: extend `--lenient` warn/skip behavior beyond WhatsApp TXT (where feasible), and decide if we need machine-readable per-warning logs beyond `--report-json`.
