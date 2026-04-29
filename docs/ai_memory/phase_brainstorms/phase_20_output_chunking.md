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
- Current writers take a single `outputPath` or write to stdout. Chunking therefore cannot target stdout (unless we introduce a container format, which is out of scope).

## CLI Contract
### Proposed flag
- `--chunk-by <none|day|month>` (default: `none`)

### Key contract decision: what does `--output` mean when chunking?
Today `--output <path>` means: write a single file (or omit to write to stdout). For chunking we must create multiple files, so `--output` must be present and must resolve to a place where multiple files can be created.

#### Option A — Output Directory Mode
**Decision:** We will use **Option A (Output Directory Mode)** for Phase 20.

**Contract (precise):**
- If `--chunk-by` is not `none`, then:
  - `--output` is **required** and is treated as a **directory**.
  - Writing to stdout is **not supported** in chunking mode.
- Directory behavior:
  - If `--output` does not exist: create it (recursive).
  - If `--output` exists and is a file: error.
  - If `--output` exists and is a directory: OK.
- Output formats:
  - In Phase 20 we support chunking for `--output-format json|md`.
  - If `--output-format csv` is used with chunking, we error (unless we explicitly expand Phase 20 scope).

**Chunk key:**
- `month`: `YYYY-MM` from `timestamp_utc` (UTC).
- `day`: `YYYY-MM-DD` from `timestamp_utc` (UTC).
- Because `timestamp_utc` is ISO 8601, deriving `YYYY-MM` / `YYYY-MM-DD` via string slicing is deterministic and avoids locale parsing issues, but we should still validate shape.

**Per-chunk file contents:**
- JSON: each chunk is a valid unified export wrapper `{ export_meta, chat_info, messages[] }`.
- Markdown: each chunk is a self-contained markdown file with a header + message list.

**Pros:**
- Very clear semantics for chunking: output is a folder of files.
- Naturally supports later phases like dedup (Phase 21) scanning a directory.
- Avoids fiddly filename/extension parsing.

**Cons:**
- `--output` currently means “file path”, so this is a semantic shift.
- Users must learn “file vs directory depending on chunking”.
- Needs decisions: directory creation behavior, base naming, extension mapping.

**Mitigation for the semantic shift:**
- The meaning of `--output` only changes when `--chunk-by` is enabled.
- Error messages should be explicit: “chunking mode expects `--output` to be a directory”.

#### Option B — Output File Suffix Mode (Minimal Change)
**Contract:**
- `--output` remains a file path.
- When chunking, the tool derives chunk paths by inserting a suffix before the extension:
  - `out.json` → `out.2026-04.json`
  - `out.md` → `out.2026-04.md`
  - No extension: `out` → `out.2026-04`

**Pros:**
- Minimal mental model change; lowest CLI surface area.
- Easy to implement and document.

**Cons:**
- Harder to organize outputs into a directory without user manually picking an `--output` path with a directory prefix.
- Slightly awkward naming when users want a clean base name per chat.
- Directory scanning for Phase 21 still works, but it’s less "obviously chunked" unless users put outputs in a folder.

#### Option C — Output Template Mode (Most Flexible)
**Contract:**
- `--output` becomes a template string when chunking, e.g.:
  - `--output ./out/{chunk}.json`
  - `--output ./out/{YYYY}-{MM}.md`

**Pros:**
- Most flexible; users can embed chat name, platform, chunk key, and organize subdirectories.

**Cons:**
- More complex and more foot-guns.
- Requires designing + documenting placeholder syntax and escaping.
- Increases support surface area.

### Common behavior across all options
- If `--chunk-by` is not `none` and `--output` is missing: error (cannot chunk to stdout).
- Chunk key is computed from `timestamp_utc` using UTC boundaries (based on the ISO 8601 string).
- Chunking assumes the message stream is chronological; we can optionally detect "time went backwards" and emit a warning or fail fast.

### Recommendation (for decision)
Decision made: **Option A (directory mode)**.

### Filename scheme (still needs a final choice)
In directory mode we need deterministic filenames that avoid collisions.

#### Scheme A1 — Minimal
- `chunk.<chunkKey>.<ext>`
  - Examples: `chunk.2026-04.json`, `chunk.2026-04.md`

Pros:
- Very simple and predictable.

Cons:
- Collides if the user exports multiple chats into the same directory.

#### Scheme A2 — Include platform (still non-PII)
- `<platform>.chunk.<chunkKey>.<ext>`
  - Example: `WHATSAPP.chunk.2026-04.json`

Pros:
- Reduces collisions across platform runs.

Cons:
- Still collides if the user exports multiple chats for the same platform into the same folder.

#### Scheme A3 — Include a stable, non-PII chat identifier (recommended)
- `<platform>.<chatId>.chunk.<chunkKey>.<ext>`
  - Example: `WHATSAPP.c3b4a1.chunk.2026-04.json`
  - `<chatId>` is deterministic and does not include raw chat name.
  - Candidate definition: short hash of `(platform + chat_name + chat_type)`.

Pros:
- Avoids collisions even when users reuse the same output directory.
- Preserves privacy (no raw chat name in filenames).

Cons:
- Adds a small amount of complexity and needs a canonical definition.

### Filename decision (locked)
We will use **Scheme A3**.

**Canonical `chatId` definition:**
- Compute a stable string `S = platform + "\n" + chat_type + "\n" + chat_name`.
- Compute `hash = sha256(S)`.
- Encode as lowercase hex and take a short prefix, e.g. `chatId = hashHex.slice(0, 8)`.

Rationale:
- Stable across runs for the same chat selection.
- Avoids leaking raw chat names into filenames.
- Avoids collisions when exporting multiple chats into the same output directory.

### Collision / overwrite policy (locked + flag)
Chunking creates many files; we need explicit behavior if target files already exist.

Options:
- **Fail fast (default):** if a chunk file already exists when we attempt to open it, error and stop.
- **Overwrite:** truncate/replace existing chunk files.

Decision: default **fail fast**, and add `--overwrite` now (Phase 20) to allow replacing existing files when explicitly requested.

Notes:
- In fail-fast mode, an error may occur mid-stream (on the first collision). Earlier chunk files may already have been written.
- If we want truly atomic behavior later, we can add a temp-file + rename strategy (out of scope for Phase 20).

## Data Model / Schema Touchpoints
- No schema changes required; chunking is an output-layer behavior.

## Approach (High Level)
- Add a chunking router stage after scrub filters and before writers.
- Keep current message stream, but write to a "current chunk" writer and rotate when `timestamp_utc` crosses boundary.
- JSON writer needs to emit a root wrapper per chunk.

### Streaming-safe implementation approach (based on current writers)
The current writer functions are one-shot and manage their own stream lifecycle (open → header → stream messages → footer → close).

For chunking, the most reliable approach is to implement dedicated chunked writers that operate directly on the single message stream:
- Track `currentChunkKey` and an open writable stream.
- On first message: open the first chunk file and emit its header.
- For each message:
  - compute `chunkKey` from `timestamp_utc`.
  - if `chunkKey` changes: finalize previous chunk (footer + close), open next chunk (header).
  - write the message.
- After the stream ends: finalize the last chunk.

This keeps memory constant and preserves backpressure.

## Implementation Plan (Phase 20)
1. **Docs/spec alignment**
  - Update `01_unified_chat_exporter_spec.md` to document `--chunk-by` + directory-mode behavior and the new `--overwrite` flag.
2. **CLI parsing + validation**
  - Add `--chunk-by <none|day|month>` to CLI (default `none`).
  - Add `--overwrite` boolean.
  - Validate: if chunking enabled → require `--output`, require directory (create if missing), forbid stdout.
3. **Chunked writer implementation**
  - Add chunked JSON writer: open/rotate/close per chunk key and emit valid wrapper per file.
  - Add chunked Markdown writer: open/rotate/close per chunk key and emit standalone header per file.
  - Enforce collision policy (fail-fast unless `--overwrite`).
4. **Wiring**
  - In convert pipeline, route to chunked writers when `--chunk-by` is enabled; otherwise use existing single-file writers.
5. **Tests**
  - Add a synthetic smoke test that streams messages spanning two chunks and asserts:
    - The correct two files are created.
    - Each file only contains messages for its chunk.
    - Ordering is preserved within each file.
  - Add a collision test: run twice into same output directory; second run fails without `--overwrite` and succeeds with it.
6. **Verification**
  - Run `bun run typecheck`, `bun run lint`, `bun run test`.
7. **Memory update**
  - Check off Phase 20 tasks in `docs/ai_memory/2_progress_tracker.md` and update `docs/ai_memory/1_active_context.md`.

## Edge Cases
- Messages out of order (some platforms may emit unsorted):
  - Decide whether to enforce chronological ordering (cannot sort without buffering).
  - Prefer: document that chunking assumes adapters emit chronological order.
- Timezone: chunking should use UTC boundaries (based on `timestamp_utc`).
- Filenames: avoid using locale-dependent date formatting; derive chunk keys from `timestamp_utc` prefix (e.g., `YYYY-MM` or `YYYY-MM-DD`).
- Empty output: if there are zero messages after filters, decide whether to write zero files or a single empty chunk file. (Recommendation: write zero files and print a warning.)

## Test Plan
- Synthetic fixture with messages spanning two months; assert two output files produced.
- Verify each chunk file is valid JSON/MD and contains only its messages.

## Open Questions
- Do we want chunking for CSV too?
- Output naming convention (YYYY-MM, YYYY-MM-DD).
- If we choose directory mode: include chat name in filenames, and if so, how do we sanitize it?
- Should out-of-order timestamps be a hard error in chunking mode?

## Phase 20 Decisions to Lock Before Coding
Locked:
- Filename scheme: **A3** (`<platform>.<chatId>.chunk.<chunkKey>.<ext>`).
- Overwrite policy: **fail-fast by default**, add `--overwrite` to override.

Still open:
- CSV chunking: Phase 20 vs defer.
- Out-of-order timestamps: warn vs hard error.

## Done When
- CLI supports time-based chunking, tests pass, docs updated.
