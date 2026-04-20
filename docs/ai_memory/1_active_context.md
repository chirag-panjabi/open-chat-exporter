# Active Context for AI Agents
**Last Updated:** April 20, 2026

## Project Identity
**Unified Chat Exporter (V1: TypeScript)**

## Current Phase: Proof of Concept Adapter (Discord JSON)
Phase 2 (types contract) and Phase 3 (CLI + streaming core) are complete.

We now have a working end-to-end pipeline for generating a unified export wrapper JSON via `--platform UNKNOWN`.

## Next High-Level Objectives
- [x] Pick the exact JavaScript/TypeScript runtime (Bun).
- [x] Initialize the project and setup the dependency structure.
- [x] Translate the JSON rules inside `03_unified_schema_definition.md` into strict TypeScript Interfaces inside a `src/types/` folder.
- [x] Build the abstract streaming engines and base Adapter logic.
- [x] Build the CLI Shell (`src/cli/index.ts`) for `convert`.
- [ ] Write the first adapter POC (Discord JSON).

## Recent Decisions Log:
- **Language:** TypeScript V1, Rust V2.
- **WhatsApp Strategy:** Tier 1 format (`.txt`) strips threaded replies. Placed `reply_to_message_id: null`. Tier 2 format (`.crypt15` SQL) handles real threads but requires user key extraction. Porting Python SQLite extraction logic from `KnugiHK/WhatsApp-Chat-Exporter` into TS rather than using native Python bindings.