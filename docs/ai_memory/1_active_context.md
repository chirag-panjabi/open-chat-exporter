# Active Context for AI Agents
**Last Updated:** April 20, 2026

## Project Identity
**Unified Chat Exporter (V1: TypeScript)**

## Current Phase: Type Definition & Core Implementation
We are now inside the **Implementation Phase**.
The project has been natively scaffolded using `npm`, strict TypeScript configurations, ESLint, and Prettier. The directories limit the scope of logic (cli vs adapters vs core). We have established `tsx` as our agile development runtime.

## Next High-Level Objectives
- [x] Pick the exact JavaScript/TypeScript runtime (Node/tsx).
- [x] Initialize the project and setup the dependency structure.
- [ ] Translate the JSON rules inside `03_unified_schema_definition.md` into strict TypeScript Interfaces inside a `src/types/` folder.
- [ ] Build the abstract streaming engines and Adapter logic.
- [ ] Write the first adapter POC (WhatsApp TXT format or Discord JSON).

## Recent Decisions Log:
- **Language:** TypeScript V1, Rust V2.
- **WhatsApp Strategy:** Tier 1 format (`.txt`) strips threaded replies. Placed `reply_to_message_id: null`. Tier 2 format (`.crypt15` SQL) handles real threads but requires user key extraction. Porting Python SQLite extraction logic from `KnugiHK/WhatsApp-Chat-Exporter` into TS rather than using native Python bindings.