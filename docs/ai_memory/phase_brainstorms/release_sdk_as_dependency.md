# Release Brainstorm — SDK / Dependency Mode (Embed Unified Chat Exporter)

**Phase:** Release Readiness (R5)
**Owner:** TBD
**Date:** 2026-04-30

## Goal (1–2 sentences)
Make this project easy to embed as a dependency in other products (e.g., a drag-and-drop UI that uploads a chat export), without those products re-implementing parsing/normalization logic.

## In Scope
- A stable, documented programmatic API (TypeScript) that other projects can call directly.
- Keep the CLI as a thin wrapper around the programmatic API.
- Packaging that works for both Bun and Node consumers.

## Out of Scope
- Building a UI in this repo.
- Owning the "upload + unzip" UX end-to-end. (Consumers can unzip externally; we may add helpers later.)
- Adding new adapters/platforms as part of this packaging work.

## Constraints (Non-Negotiables)
- Streaming-first (no buffering `messages[]`).
- No media in V1 (only `metadata.has_attachment`).
- Synthetic fixtures only; never commit exports/DBs/keys.

## API Contract (Proposed)
- Entry points (names TBD):
  - `createAdapter({ platform, inputPath, ... })` → returns an adapter instance.
  - `convertToUnifiedExport({ adapter, outputFormat, outputPath, ... })` → runs the pipeline.
  - Or a single convenience function: `convert({ platform, inputPath, outputFormat, outputPath, ...flags })`.
- Options should mirror CLI flags, but without `process.exit`.
- Errors should be thrown as typed errors (or error codes) so hosts can render UX.

## Packaging Contract (Proposed)
- Publish a package that exposes:
  - `exports` for public API (e.g., `unified-chat-exporter` or `unified-chat-exporter/sdk`).
  - a `bin` entry for CLI use.
- Build outputs:
  - compile to `dist/` for Node consumers.
  - keep source available for Bun, but avoid requiring TS transpilation in consuming apps.

## Approach (High Level)
- Create a new public entry module (e.g., `src/index.ts`) that re-exports only stable APIs.
- Refactor CLI wiring in `src/cli/index.ts` to call the public API rather than duplicating pipeline orchestration.
- Add a small "library usage" example (no UI) demonstrating embedding:
  - host provides a path to an extracted export file/dir.
  - host chooses `outputFormat` and target output.

## Edge Cases
- Adapters that accept directories (Slack, Phase 20 chunk dirs) vs files: API must accept both and validate.
- Temp file management (dedup DB, chunk dirs): API should allow host-provided temp dir.
- Logging: API should allow passing a logger callback or be silent by default.

## Test Plan
- Add a smoke test that imports the library API (not the CLI) and runs a small fixture conversion.
- Ensure behavior matches CLI for:
  - exit codes and error messages (CLI-specific)
  - output bytes (library + CLI parity)

## Open Questions
- Do we keep CommonJS (`"type": "commonjs"`) or migrate to ESM + dual exports?
- What should be considered "public" vs "internal" modules?
- Should we add a helper for zip extraction (likely to temp dir) or leave to hosts?

## Done When
- A consuming TS project can `import` the SDK and run a conversion without invoking a subprocess.
- CLI continues to work unchanged, but delegates to the SDK.
- Packaging is documented and verifiable via a smoke test.
