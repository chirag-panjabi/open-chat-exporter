# Task Tracking Loop (To-Do List)
*Agents: Claim a task, plan it, execute it, check it off.*

## Phase 1: Project Scaffolding
- [x] **Task 1.1:** Initialize the TypeScript package (using `bun init` or `npm init` + `tsc`).
- [x] **Task 1.2:** Establish the `src/` folder structure (`cli`, `core`, `adapters`, `types`, `utils`).
- [x] **Task 1.3:** Setup the ESLint / Prettier code formatters to ensure strict typing.

## Phase 2: Type Definition (The Contract)
- [x] **Task 2.1:** Convert `03_unified_schema_definition.md` into exact TypeScript interfaces (e.g., `IUnifiedExport`, `IExportMeta`, `IChatInfo`, `IUnifiedMessage`, `ISender`, `IMessageContext`, `IReaction`, `IInteractions`, `IMessageMetadata`) and enums (`Platform`, `ChatType`).
- [x] **Task 2.2:** Add JSDoc comments to enforce the normalization mathematical rules (e.g. `timestamp_utc` must be ISO 8601).

## Phase 3: The CLI Core & Streaming Engine
- [x] **Task 3.1:** Setup the CLI entry point in `src/cli/index.ts` (e.g. `bun run src/cli/index.ts convert --input <file> --platform <discord>`).
- [x] **Task 3.2:** Implement the abstract base class `BaseAdapter` inside `src/core/BaseAdapter.ts`. Every platform adapter must extend this class and implement `parseMessages()` that yields `IUnifiedMessage`.
- [x] **Task 3.3:** Configure Bun's native streaming APIs (`Bun.file().stream()`) as the required input mechanism for adapters.

## Phase 4: Proof of Concept Adapter (Discord JSON)
- [x] **Task 4.1:** Write `src/adapters/discord/DiscordJsonAdapter.ts`. Implement token-by-token JSON parsing (e.g., using `stream-json`) instead of `JSON.parse()`. Added a synthetic fixture + smoke test.

## Phase 5: Complex Adapter (WhatsApp TXT parsing)
- [x] **Task 5.1:** Write the raw line-by-line file reader for `src/adapters/whatsapp/WhatsAppTxtAdapter.ts`.
- [x] **Task 5.2:** Implement locale-aware, resilient timestamp regex pattern logic for WhatsApp `.txt` messages.
- [x] **Task 5.3:** Set `reply_to_message_id: null` universally.
- [x] **Task 5.4:** Write the test suite specifically for multiline messages to ensure they don't break the line-reader chunking algorithm.

## Phase 6: Proof of Concept Adapter (Telegram JSON)
- [x] **Task 6.1:** Write `src/adapters/telegram/TelegramJsonAdapter.ts` with streaming JSON parsing (no `JSON.parse()` on full file).
- [x] **Task 6.2:** Flatten Telegram rich text arrays into Markdown strings for `content`.
- [x] **Task 6.3:** Wire `--platform TELEGRAM` into the CLI and add a synthetic fixture + smoke test.

## Phase 7: Adapter (Facebook Messenger JSON)
- [x] **Task 7.1:** Write `src/adapters/fb_messenger/FacebookMessengerJsonAdapter.ts` using streaming JSON parsing over `messages[]`.
- [x] **Task 7.2:** Wire `--platform FB_MESSENGER` into the CLI and add a synthetic fixture + smoke test.

## Phase 8: Adapter (Instagram JSON)
- [x] **Task 8.1:** Write `src/adapters/instagram/InstagramJsonAdapter.ts` using streaming JSON parsing over `messages[]`.
- [x] **Task 8.2:** Wire `--platform INSTAGRAM` into the CLI and add a synthetic fixture + smoke test.

## Phase 9: Adapter (Snapchat JSON)
- [x] **Task 9.1:** Write `src/adapters/snapchat/SnapchatJsonAdapter.ts` using streaming JSON parsing (Snapchat `chat_history.json`).
- [x] **Task 9.2:** Wire `--platform SNAPCHAT` into the CLI and add a synthetic fixture + smoke test.

## Phase 10: Adapter (LinkedIn Messages CSV)
- [x] **Task 10.1:** Write `src/adapters/linkedin/LinkedInMessagesCsvAdapter.ts` using streaming CSV parsing (including quoted newlines).
- [x] **Task 10.2:** Wire `--platform LINKEDIN` into the CLI and add a synthetic fixture + smoke test.

## Phase 11: Adapter (Google Chat JSON)
- [x] **Task 11.1:** Write `src/adapters/goog_chat/GoogleChatJsonAdapter.ts` using streaming JSON parsing over `messages[]`.
- [x] **Task 11.2:** Wire `--platform GOOG_CHAT` into the CLI and add a synthetic fixture + smoke test.

## Phase 12: Adapter (Microsoft Teams JSON)
- [x] **Task 12.1:** Write `src/adapters/ms_teams/MicrosoftTeamsJsonAdapter.ts` using streaming JSON parsing over `messages[]`.
- [x] **Task 12.2:** Wire `--platform MS_TEAMS` into the CLI and add a synthetic fixture + smoke test.

## Phase 13: Adapter (X / Twitter DMs)
- [x] **Task 13.1:** Write `src/adapters/x_twitter/XTwitterDirectMessagesJsAdapter.ts` using streaming parsing for `direct-messages.js` (JS-wrapped JSON).
- [x] **Task 13.2:** Wire `--platform X_TWITTER` into the CLI and add a synthetic fixture + smoke test.

## Phase 14: Adapter (Skype)
- [x] **Task 14.1:** Write `src/adapters/skype/SkypeMessagesJsonAdapter.ts` using streaming JSON parsing for `messages.json`.
- [x] **Task 14.2:** Wire `--platform SKYPE` into the CLI and add a synthetic fixture + smoke test.

## Phase 15: Adapter (Slack)
- [x] **Task 15.1:** Write `src/adapters/slack/SlackJsonAdapter.ts` using streaming JSON parsing over Slack message arrays.
- [x] **Task 15.2:** Wire `--platform SLACK` into the CLI and add a synthetic fixture + smoke test.

## Phase 16: Adapter (iMessage - macOS `chat.db`)
- [x] **Task 16.1:** Identify the minimal SQLite tables/fields required to stream iMessage messages from macOS `chat.db`.
- [x] **Task 16.2:** Implement a streaming-safe iMessage adapter (no full-table loads) that maps into the unified schema.
- [x] **Task 16.3:** Add synthetic fixtures + smoke test for iMessage.
- [x] **Task 16.4:** Wire `--platform IMESSAGE` into the CLI.

## Phase 17: Adapter (WhatsApp - Reply-Aware via DB/Backups)
- [x] **Task 17.1:** Document the limitations of WhatsApp `.txt` exports for reply/quote mapping and define the DB-first approach (iOS backup / decrypted DB) to populate `context.reply_to_message_id`.
- [x] **Task 17.2:** Add a WhatsApp iOS DB adapter that reads an extracted WhatsApp chat database file from a decrypted iOS backup (user provides the extracted DB path).
- [x] **Task 17.3:** Implement a streaming-safe reply resolution strategy (two-pass with on-disk key→`message_id` lookup, or best-effort bounded cache).
- [x] **Task 17.4:** Add synthetic fixtures + smoke test proving reply-to mapping works end-to-end without committing real exports.
- [x] **Task 17.5:** Update spec/docs to reflect the reply-aware WhatsApp import path (inspired by iMazing’s backup-based extraction workflow).

## Phase 18: Adapter (Meta Conversations API - Reply-Aware, Optional)
- [x] **Task 18.1:** Document scope/constraints: eligible surfaces (Page + Instagram Professional messaging), auth model, and platform limitations (notably: message detail access is limited to recent messages).
- [x] **Task 18.2:** Design the adapter inputs for CLI (tokens/config), ensuring secrets are never written to repo and can be provided via env vars.
- [x] **Task 18.3:** Implement a Conversations API adapter that streams/paginates messages (no full-history in-memory loads) and maps into the unified schema.
- [x] **Task 18.4:** Populate `context.reply_to_message_id` by resolving `reply_to.mid` → unified `message_id` (best-effort, with clear null fallback when unresolved).
- [x] **Task 18.5:** Add synthetic fixtures + smoke test using recorded/handcrafted JSON responses (no real exports/tokens) to validate reply-to mapping.
- [x] **Task 18.6:** Update spec/docs to clearly distinguish offline Meta exports (reply graphs typically unavailable) vs API ingestion (reply graphs possible but gated/limited).

## Phase 19: Scrubbing + Output Formats (Markdown/CSV)
- [x] **Task 19.1:** Define CLI contract for scrubbing + output formats (flags, config file formats, default behaviors) and update the core spec accordingly.
- [x] **Task 19.2:** Implement identity resolution via `identities.yaml` → populate `sender.resolved_name` (streaming-safe).
- [x] **Task 19.3:** Implement optional anonymization pass that replaces alias strings in `content` with `resolved_name` (best-effort, boundary-aware).
- [x] **Task 19.4:** Implement time-boxing + cleanup filters (e.g., `--since/--until`, drop system messages, min content length) as a streaming transform.
- [x] **Task 19.5:** Add Markdown writer (`--output-format md`) with a stable, minimal format.
- [x] **Task 19.6:** Add CSV writer (`--output-format csv`) with correct escaping and a stable header.
- [x] **Task 19.7:** Add synthetic fixtures + smoke tests proving scrub + MD/CSV output works end-to-end without loading exports into memory.

## Phase 20: Output Chunking (Time / Token Budget)
- [x] **Task 20.1:** Define and document the CLI contract for time-based chunking using **directory-mode** output.
- [x] **Task 20.2:** Implement time-based chunking for `md` and `json` outputs (streaming-safe, no buffering `messages[]`), using filename scheme: `<platform>.<chatId>.chunk.<chunkKey>.<ext>`.
- [x] **Task 20.3:** Implement collision policy: fail-fast by default; add `--overwrite` to allow replacing existing chunk files.
- [x] **Task 20.4:** Add synthetic fixture + smoke tests proving: deterministic chunk boundaries, ordering preserved, and overwrite/collision behavior.

## Phase 21: Incremental Export + Deduplication
- [x] **Task 21.1:** Define CLI contract for incremental runs (dedup against an existing unified export) in a streaming-safe way.
- [x] **Task 21.2:** Implement streaming-safe dedup (prefer on-disk index like SQLite; avoid in-memory sets for huge histories).
- [x] **Task 21.3:** Add synthetic fixture + smoke test proving dedup drops previously-seen `message_id`s.

## Phase 22: Adapter (WhatsApp - Android DB, Reply-Aware)
- [x] **Task 22.1:** Document required inputs and constraints (decrypted Android DBs; key extraction remains out-of-scope for this repo).
- [x] **Task 22.2:** Implement Android WhatsApp DB adapter with reply mapping into `context.reply_to_message_id` (streaming-first).
- [x] **Task 22.3:** Add synthetic fixtures + smoke test for Android DB reply mapping.

## Release Readiness (V1)
- [ ] **Task R1:** Decide packaging approach (Bun compile/single binary vs source-only) and document supported install/run paths.
- [x] **Task R2:** Add a minimal README with: supported inputs per platform, example commands, and safety notes (no PII in repo; media excluded).
- [ ] **Task R3:** Add a "large export" guide: streaming constraints, expected memory profile, and recommended chunking/dedup workflows.
- [ ] **Task R4:** Add a release checklist (version bump, `bun run typecheck/lint/test`, `git status`, fixture-only tests).
- [x] **Task R5:** Support SDK/dependency usage (stable programmatic API + package exports) so other products can embed parsing/normalization without shelling out to the CLI.
- [x] **Task R6:** Add output profiles for strict downstream schemas (e.g., a minimal JSON array profile) without changing the canonical unified wrapper schema.
- [x] **Task R7:** Improve reliability + integration controls: lenient parse mode (warn/skip), structured reporting (`--report-json`), and logging controls (`--quiet`, machine-readable logs).
	- Implemented: `--report-json`, `--quiet`, `--lenient` baseline (WhatsApp TXT: warn + treat invalid header-like lines as continuation)
	- Remaining: extend lenient behavior to more adapters where feasible; decide whether per-warning machine-readable logs are needed beyond the report JSON
