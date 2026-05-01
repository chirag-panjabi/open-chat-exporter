# Unified Chat Exporter (V1)

Streaming-first conversion of multiple chat export formats into a single unified schema.

- **Runtime:** Bun
- **No media in V1:** attachments are represented only via `metadata.has_attachment` (no files extracted)
- **Streaming constraints:** adapters and writers avoid loading full exports into memory

## Quickstart

```bash
bun install

# Convert an export (defaults to JSON, canonical wrapper)
bun run src/cli/index.ts convert \
  --input <path> \
  --platform <PLATFORM> \
  --output out.json
```

Show CLI help:

```bash
bun run src/cli/index.ts --help
```

## Supported Inputs (High-Level)

This repo includes streaming adapters and synthetic smoke tests for:

- `DISCORD`: DiscordChatExporter JSON
- `WHATSAPP`: WhatsApp `.txt` export
- `WHATSAPP` (SQLite): iOS `ChatStorage.sqlite` or Android decrypted `msgstore.db`-style SQLite (see `--wa-chat-jid` / `--wa-chat-pk`)
- `TELEGRAM`: `result.json`
- `SLACK`: Slack export JSON
- `IMESSAGE`: macOS Messages SQLite `chat.db` (requires `--chat-guid`)
- `FB_MESSENGER`, `INSTAGRAM`, `GOOG_CHAT`, `SNAPCHAT`, `LINKEDIN`, `MS_TEAMS`, `X_TWITTER`, `SKYPE`
- `META_CONVERSATIONS_API`: via config JSON + env var token (fixtures supported for tests)

## Output Formats

- `--output-format json|md|csv` (default: `json`)
- `--output-profile canonical|messages-array|minimal` (JSON only)
  - `canonical`: `{ meta, chat_info, messages: [...] }` (default)
  - `messages-array`: just `messages: [...]` as a root array
  - `minimal`: root JSON array of minimal message objects for strict downstream consumers

Schema source of truth: [03_unified_schema_definition.md](03_unified_schema_definition.md)

## Reliability & Reporting

- `--lenient`: best-effort parsing where feasible (currently most useful for line-based inputs like WhatsApp `.txt`)
- `--report-json <path>`: writes a small JSON run report (includes warning counts)
- `--quiet`: suppress non-error stderr output

## Large Exports

Recommended chunking + dedup workflows: [docs/LARGE_EXPORT_GUIDE.md](docs/LARGE_EXPORT_GUIDE.md)

## Safety (Open Source)

This project handles highly sensitive personal data.

- Never commit real exports, databases, backups, or tokens.
- Keep local data in ignored folders like `data/`, `exports/`, or `private/`.

See: [docs/OPEN_SOURCE_SAFETY.md](docs/OPEN_SOURCE_SAFETY.md)

## Dev

```bash
bun run typecheck
bun run lint
bun run test
```
