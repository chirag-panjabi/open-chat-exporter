# Open Chat Exporter (V1)

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

Install/run paths (V1 decision): [docs/PACKAGING_AND_RUN_PATHS.md](docs/PACKAGING_AND_RUN_PATHS.md)

## Integration Quickstart (Host Apps)

If you are integrating this tool into a desktop/mobile app (IPC-style), the recommended path is:

1) Build the standalone executable:

```bash
bun install
bun run build:exe
```

2) Run conversions with **structured stderr events** and data written to a file:

```bash
./dist/open-chat-exporter-<os>-<arch> convert \
  --input <path> \
  --platform <PLATFORM> \
  --output out.json \
  --output-format json \
  --output-profile minimal \
  --log-format jsonl \
  2> run.events.jsonl
```

3) Parse `run.events.jsonl` line-by-line (JSONL). Contract and event types: [docs/LOG_FORMAT_JSONL.md](docs/LOG_FORMAT_JSONL.md)

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
  - `canonical`: `{ export_meta, chat_info, messages: [...] }` (default)
  - `messages-array`: root JSON array of unified message objects (the same shape as `messages[]` items in `canonical`)
  - `minimal`: root JSON array of minimal message objects for strict downstream consumers

Schema source of truth: [03_unified_schema_definition.md](03_unified_schema_definition.md)

## Reliability & Reporting

- `--lenient`: best-effort parsing where feasible (currently most useful for line-based inputs like WhatsApp `.txt`)
- `--report-json <path>`: writes a small JSON run report (includes warning counts)
- `--quiet`: suppress non-error stderr output
- `--log-format jsonl`: emit warnings/progress/fatal events as JSONL on stderr (for UI/IPC); see [docs/LOG_FORMAT_JSONL.md](docs/LOG_FORMAT_JSONL.md)

## Large Exports

Recommended chunking + dedup workflows: [docs/LARGE_EXPORT_GUIDE.md](docs/LARGE_EXPORT_GUIDE.md)

## Release

Release checklist: [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)

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

## License

Apache-2.0 (see [LICENSE](LICENSE)).
