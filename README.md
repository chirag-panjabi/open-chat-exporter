# Open Chat Exporter

Streaming-first conversion of multiple chat export formats into a single unified schema.

- **Runtime:** Bun
- **No media in V1:** attachments are represented only via `metadata.has_attachment` (no files extracted)
- **Streaming-safe:** adapters and writers avoid loading full exports into memory

Schema source of truth: [03_unified_schema_definition.md](03_unified_schema_definition.md)

## Docs

- Large exports (chunking + dedup): [docs/LARGE_EXPORT_GUIDE.md](docs/LARGE_EXPORT_GUIDE.md)
- Machine-readable stderr events (JSONL): [docs/LOG_FORMAT_JSONL.md](docs/LOG_FORMAT_JSONL.md)
- Packaging + supported run paths: [docs/PACKAGING_AND_RUN_PATHS.md](docs/PACKAGING_AND_RUN_PATHS.md)
- Open-source safety rules: [docs/OPEN_SOURCE_SAFETY.md](docs/OPEN_SOURCE_SAFETY.md)
- Release checklist: [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)

## Why

If you have chat history across multiple platforms, each export format is different (and often huge). This tool normalizes them into a minimal, predictable schema that is friendly for LLM/RAG ingestion and downstream analytics.

## Install & Run

### From source

```bash
bun install
bun run src/cli/index.ts --help
```

### Build a standalone executable

```bash
bun install
bun run build:exe

# Example:
./dist/open-chat-exporter-<os>-<arch> --help
```

Packaging/install notes: [docs/PACKAGING_AND_RUN_PATHS.md](docs/PACKAGING_AND_RUN_PATHS.md)

## Quickstart

Convert an export (defaults to JSON, canonical wrapper):

```bash
bun run src/cli/index.ts convert \
  --input <path> \
  --platform <PLATFORM> \
  --output out.json \
  --chat-name "My Chat" \
  --chat-type GROUP
```

Tip: omit `--output` (or set it to `-`) to write to stdout.

## Common Workflows

### Minimal JSON array (for strict downstream consumers)

```bash
bun run src/cli/index.ts convert \
  --input <path> \
  --platform <PLATFORM> \
  --output out.minimal.json \
  --output-format json \
  --output-profile minimal
```

### Scrub identities + anonymize content

```bash
bun run src/cli/index.ts convert \
  --input <path> \
  --platform <PLATFORM> \
  --output out.scrubbed.md \
  --output-format md \
  --identities identities.yaml \
  --anonymize \
  --drop-system
```

### Chunk large exports by month

Chunking requires `--output` to be a directory and is supported for `json` and `md`.

```bash
bun run src/cli/index.ts convert \
  --input <path> \
  --platform <PLATFORM> \
  --output out_chunks/ \
  --output-format json \
  --chunk-by month
```

### Incremental exports (dedup against a prior run)

```bash
bun run src/cli/index.ts convert \
  --input <path> \
  --platform <PLATFORM> \
  --output out.delta.json \
  --dedup-against out.baseline.json
```

### Integration / IPC mode (structured stderr events)

Emit machine-readable JSONL logs on stderr (progress/warnings/fatal) and write output to a file:

```bash
./dist/open-chat-exporter-<os>-<arch> convert \
  --input <path> \
  --platform <PLATFORM> \
  --output out.json \
  --output-format json \
  --output-profile minimal \
  --log-format jsonl \
  --report-json run.report.json \
  2> run.events.jsonl
```

JSONL contract: [docs/LOG_FORMAT_JSONL.md](docs/LOG_FORMAT_JSONL.md)

## Supported Platforms & Inputs

This repo includes streaming adapters and synthetic smoke tests for:

| Platform | Input artifact | Notes |
| --- | --- | --- |
| `DISCORD` | DiscordChatExporter JSON | Supports replies (when present) and basic reactions. |
| `WHATSAPP` | WhatsApp `.txt` export | Consumer `.txt` exports do **not** include reply/thread metadata; `reply_to_message_id` is always `null`. |
| `WHATSAPP` (SQLite) | iOS `ChatStorage.sqlite` or decrypted Android `msgstore.db` | Reply mapping supported; selection via `--wa-chat-jid` / `--wa-chat-pk`. |
| `TELEGRAM` | `result.json` | Flattens rich-text arrays into Markdown. |
| `SLACK` | Slack message JSON array | Supports `thread_ts` threading and reactions (when present). |
| `IMESSAGE` | macOS Messages `chat.db` | Requires `--chat-guid`; supports basic reply context via `thread_originator_guid` when available. |
| `FB_MESSENGER` | Offline Messenger JSON | Attachments flagged via `metadata.has_attachment`. |
| `INSTAGRAM` | Offline Instagram JSON | Attachments flagged via `metadata.has_attachment`. |
| `GOOG_CHAT` | Google Chat JSON | Best-effort mapping. |
| `MS_TEAMS` | Microsoft Teams JSON | Best-effort mapping. |
| `SNAPCHAT` | `chat_history.json` | Best-effort mapping. |
| `LINKEDIN` | LinkedIn messages CSV | Streaming CSV parsing (quoted newlines supported). |
| `X_TWITTER` | `direct-messages.js` (JS-wrapped JSON) | Streaming-safe JS wrapper handling. |
| `SKYPE` | `messages.json` | Best-effort mapping. |
| `META_CONVERSATIONS_API` | Config JSON + env token (or fixtures) | Streams Graph API pages; best-effort `reply_to.mid` mapping when enabled. |

Planned placeholders (not implemented yet): `SIGNAL`, `WECHAT`, `LINE`, `KAKAOTALK`, `VIBER`.

## Output

### Output formats

- `--output-format json|md|csv` (default: `json`)

### JSON output profiles

- `--output-profile canonical|messages-array|minimal` (JSON only)
  - `canonical` (default): `{ "export_meta": {…}, "chat_info": {…}, "messages": [ … ] }`
  - `messages-array`: root JSON array of unified message objects (the same shape as `messages[]` items in `canonical`)
  - `minimal`: root JSON array of:

    ```json
    {
      "platform": "DISCORD",
      "timestamp_utc": "2026-05-05T12:00:00.000Z",
      "sender_name": "Alice#1234",
      "message_content": "Hello"
    }
    ```

  ## Reliability & Reporting

  - `--lenient`: best-effort parsing where feasible (currently most useful for WhatsApp `.txt`)
  - `--quiet`: suppress non-error stderr output
  - `--report-json <path>`: write a small JSON run report (includes warnings by code)
  - `--log-format text|jsonl`: controls stderr format only (output files are unchanged)

## Large Exports

Recommended chunking + dedup workflows: [docs/LARGE_EXPORT_GUIDE.md](docs/LARGE_EXPORT_GUIDE.md)

## Safety & Privacy (Open Source)

This project handles highly sensitive personal data.

- Never commit real exports, databases, backups, or tokens.
- Keep local data in ignored folders like `data/`, `exports/`, or `private/`.
- When reporting bugs, do **not** upload raw exports. Prefer:
  - CLI command used
  - `--report-json` output
  - `--log-format jsonl` stderr output
  - a tiny, redacted excerpt that still reproduces the issue

See: [docs/OPEN_SOURCE_SAFETY.md](docs/OPEN_SOURCE_SAFETY.md)

## Development

```bash
bun run typecheck
bun run lint
bun run test
```

## License

Apache-2.0 (see [LICENSE](LICENSE)).
