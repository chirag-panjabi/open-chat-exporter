# Active Context for AI Agents
**Last Updated:** April 20, 2026

## Project Identity
**Unified Chat Exporter (V1: TypeScript)**

## Current Phase: Core Engine & CLI Architecture
The **Implementation Phase (Type Definition)** is complete.
The `src/types/index.ts` file now acts as the strict contract for all data adapters. We are successfully using `bun` as the native execution engine.

## Next High-Level Objectives
- [x] Pick the exact JavaScript/TypeScript runtime (Bun).
- [x] Initialize the project and setup the dependency structure.
- [x] Translate the JSON rules inside `03_unified_schema_definition.md` into strict TypeScript Interfaces inside a `src/types/` folder.
- [ ] Build the abstract streaming engines and base Adapter logic.
- [ ] Build the CLI Shell (`commander` / `yargs` / `bun:cli`).
- [ ] Write the first adapter POC (WhatsApp TXT format or Discord JSON).

## Recent Decisions Log:
- **Language:** TypeScript V1, Rust V2.
- **WhatsApp Strategy:** Tier 1 format (`.txt`) strips threaded replies. Placed `reply_to_message_id: null`. Tier 2 format (`.crypt15` SQL) handles real threads but requires user key extraction. Porting Python SQLite extraction logic from `KnugiHK/WhatsApp-Chat-Exporter` into TS rather than using native Python bindings.