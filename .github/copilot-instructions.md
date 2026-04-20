# Copilot Instructions (Unified Chat Exporter)

## Source of Truth
- Treat `03_unified_schema_definition.md` as authoritative for the JSON format.
- Keep `src/types/index.ts` aligned with the schema.
- Before coding, read:
  - `docs/ai_memory/1_active_context.md`
  - `docs/ai_memory/2_progress_tracker.md`
  - `docs/ai_memory/AI_WORKFLOW.md`

## Runtime  Tooling
- Use **Bun** for installs, scripts, and execution (`bun`, `bunx`).
- Prefer Bun-native capabilities where possible (e.g., streaming via `Bun.file(...).stream()` and SQLite via `bun:sqlite` when we reach DB adapters).

## Non-Negotiables (Red Team Constraints)
- Do not load whole exports into memory (`readFileSync`, `await file.text()`, `JSON.parse(wholeFile)` are forbidden for large datasets).
- Media is excluded in V1: store only `metadata.has_attachment`.

## Open Source Safety
- Never commit real user chat exports, databases, backups, or decryption keys.
- Use only synthetic test fixtures.
- If you add any sample files, keep them minimal and scrubbed.

## Process
- Make the smallest change that satisfies the task.
- After changes: run typecheck and update `docs/ai_memory/` files.
