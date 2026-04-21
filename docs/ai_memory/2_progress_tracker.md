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