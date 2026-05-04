# `--log-format jsonl` (stderr event stream)

This CLI supports a machine-readable logging mode intended for host apps (e.g., desktop/mobile shells) that need **structured progress/warning/error signals** while reading the converted data from files/stdout.

## Contract (stdout vs stderr)

- **Output data** is written to **stdout** (default) or to `--output <path>` (file).
- **Logs/events** are always written to **stderr**.
- When `--log-format jsonl` is set, stderr becomes a **JSONL event stream**: **one JSON object per line**.

This separation is intentional so an integrating app can:
- stream/pipe the conversion output without being polluted by logs
- parse stderr independently as an IPC-like channel

## How to enable

```bash
bun run src/cli/index.ts convert ... --log-format jsonl

# or, for a standalone executable
./dist/unified-chat-exporter-<os>-<arch> convert ... --log-format jsonl
```

### `--quiet`

- `--quiet` suppresses non-fatal stderr output.
- In JSONL mode, `--quiet` suppresses `start`, `progress`, `warning`, `finish`, and `dedup` events.
- `fatal` events are still emitted.

## Parsing guidance

- Treat each line as an independent JSON object.
- **Ignore unknown keys** (new keys may be added over time).
- Use the `type` field to route events.
- Use `ts` (ISO-8601) for timestamps.

## Event types

Every JSONL event includes:
- `type` (string)
- `ts` (string, ISO-8601)

Events currently emitted:

### `start`
Emitted once at the beginning of a run (unless `--quiet`).

Common fields:
- `platform`
- `output_format`
- `output_profile`
- `chunk_by`
- `lenient`
- `dedup_enabled`
- `log_format`

### `progress`
Emitted periodically in JSONL mode (unless `--quiet`).

Common fields:
- `platform`
- `messages_emitted` (number)

Notes:
- Progress is best-effort and not guaranteed to appear at fixed intervals.

### `warning`
Emitted for recoverable issues (unless `--quiet`).

Common fields:
- `code` (string)
- `message` (string)
- plus optional adapter-specific metadata

### `dedup`
Emitted after completion when `--dedup-against` is used (unless `--quiet`).

Common fields:
- `platform`
- dedup stats fields (these match the report JSON `dedup` object)

### `finish`
Emitted once at the end of a run (unless `--quiet`).

Common fields:
- `platform`
- `success` (boolean)
- `duration_ms` (number)
- `messages_emitted` (number)
- `warnings_count` (number)

Notes:
- You may see `finish` with `success: false` for handled errors (often alongside a `fatal` event).

### `fatal`
Emitted on a run-ending error (always emitted, even with `--quiet`).

Common fields:
- `message` (string)
- `code` (string)
- `usage` (string, optional)
- `stack` (string, optional)

Notes:
- A `fatal` event typically corresponds to a non-zero process exit code.
- Depending on where the error occurs, `fatal` may be followed by a `finish` event (unless `--quiet`). For uncaught errors, only `fatal` is guaranteed.

## Example: capture JSONL to a file

```bash
bun run src/cli/index.ts convert \
  --input tests/fixtures/whatsapp/whatsapp_lenient_invalid_timestamp.sample.txt \
  --platform WHATSAPP \
  --output out.json \
  --output-format json \
  --output-profile minimal \
  --lenient \
  --log-format jsonl \
  2> run.events.jsonl
```

Your host app can then parse `run.events.jsonl` line-by-line.
