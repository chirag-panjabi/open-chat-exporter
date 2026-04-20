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
- [ ] **Task 3.1:** Setup the CLI entry point in `src/cli/index.ts` (e.g. `bun --bun index.ts --input <file> --platform <discord>`).
- [ ] **Task 3.2:** Implement the abstract base class `BaseAdapter` inside `src/core/BaseAdapter.ts`. Every platform adapter must extend this class and implement `parseStream()` that strictly outputs `IUnifiedMessage`.
- [ ] **Task 3.3:** Configure Bun's native streaming APIs (`Bun.file().stream()`) to parse chunked blobs rather than dropping into `fs.readFileSync`.

## Phase 4: Proof of Concept Adapter (Discord JSON)
- [ ] **Task 4.1:** Write `src/adapters/discord/DiscordJsonAdapter.ts`. Implement token-by-token JSON parsing (e.g., using `stream-json`) instead of `JSON.parse()`. Needs mocking/testing.

## Phase 5: Complex Adapter (WhatsApp TXT parsing)
- [ ] **Task 5.1:** Write the raw line-by-line file reader for `src/adapters/whatsapp/WhatsAppTxtAdapter.ts`.
- [ ] **Task 5.2:** Implement locale-aware, resilient timestamp regex pattern logic for WhatsApp `.txt` messages.
- [ ] **Task 5.3:** Set `reply_to_message_id: null` universally.
- [ ] **Task 5.4:** Write the test suite specifically for multiline messages to ensure they don't break the line-reader chunking algorithm.