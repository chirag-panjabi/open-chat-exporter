# Phase 22 Brainstorm — WhatsApp Android DB (Reply-Aware)

**Phase:** 22
**Owner:** TBD
**Date:** 2026-04-30

## Goal (1–2 sentences)
Parse a user-supplied, already-decrypted WhatsApp Android database to recover reply relationships and populate `context.reply_to_message_id` streaming-first.

## In Scope
- An Android DB adapter that yields `IUnifiedMessage` with stable `message_id` and best-effort `reply_to_message_id`.
- CLI wiring to select this adapter based on input format (similar to iOS SQLite sniffing).
- Synthetic SQLite fixtures + smoke tests.

## Out of Scope
- Extracting decryption keys from devices.
- Decrypting `.crypt*` files (user must provide a decrypted DB artifact).

## Constraints (Non-Negotiables)
- Streaming-first: no full-table loads.
- No media extraction; only set `metadata.has_attachment`.
- Safety: fixtures only; never store real DBs/keys.

## CLI Contract
- Candidate contract (to finalize):
  - `--platform WHATSAPP` + DB sniffing chooses iOS vs Android adapters
  - Android may require selecting a chat (jid or chat id) like iOS does

## Data Model / Schema Touchpoints
- `context.reply_to_message_id` is the key output difference vs `.txt`.

## Approach (High Level)
- Introspect Android schema at runtime (table/column presence) to handle drift.
- Implement reply mapping via direct foreign keys when available; otherwise use a two-pass on-disk index (similar to iOS stanza strategy).

## Edge Cases
- Group chats vs direct chats: selecting the right conversation/table join.
- Mixed timestamp units/epochs.
- Deleted/edited/system messages mapping.

## Test Plan
- Minimal synthetic DB schema with two messages and a reply pointer; assert `reply_to_message_id` resolves.

## Open Questions
- What is the smallest stable Android schema slice we want to support first (msgstore vs wa.db interplay)?
- How do we select a single chat robustly across schema versions?

## Done When
- Android DB adapter works on synthetic fixture and is wired into CLI without breaking existing WhatsApp TXT/iOS paths.
