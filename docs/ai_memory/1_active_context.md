# Active Context for AI Agents
**Last Updated:** April 21, 2026

## Project Identity
**Unified Chat Exporter (V1: TypeScript)**

## Current Phase: Adapters (Streaming-first)
Phase 1 (scaffolding), Phase 2 (types contract), and Phase 3 (CLI + streaming core) are complete.

We now have end-to-end conversion with streaming adapters and smoke tests for:
- Discord JSON (`DISCORD`)
- WhatsApp TXT (`WHATSAPP`)
- Telegram JSON (`TELEGRAM`)
- Facebook Messenger JSON (`FB_MESSENGER`)
- Google Chat JSON (`GOOG_CHAT`)
- Instagram JSON (`INSTAGRAM`)
- Snapchat JSON (`SNAPCHAT`)
- LinkedIn Messages CSV (`LINKEDIN`)
- Microsoft Teams JSON (`MS_TEAMS`)
- X (Twitter) DMs (`X_TWITTER`)

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
- [ ] Implement the next platform adapter (next up: X/Twitter DMs, then Skype).

## Recent Decisions Log:
- **Language:** TypeScript V1, Rust V2.
- **WhatsApp Strategy:** Tier 1 format (`.txt`) strips threaded replies. Placed `reply_to_message_id: null`. Tier 2 format (`.crypt15` SQL) handles real threads but requires user key extraction. Porting Python SQLite extraction logic from `KnugiHK/WhatsApp-Chat-Exporter` into TS rather than using native Python bindings.