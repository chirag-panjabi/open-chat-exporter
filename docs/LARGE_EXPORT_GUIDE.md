# Large Export Guide (Streaming + Reliability)

This project is designed to process **large chat exports** without loading entire datasets into memory.

## Key Principles

- Prefer **file output** for large runs (avoid piping gigantic JSON to terminals).
- Use **chunking** to keep output sizes manageable.
- Use **dedup** for incremental runs to avoid re-processing already-exported message IDs.
- Use **reporting** to audit results without parsing output files.

## Recommended Workflows

### 1) Chunk large outputs

For very large chats, write to a directory and enable chunking:

```bash
bun run src/cli/index.ts convert \
  --input <path> \
  --platform <PLATFORM> \
  --output out_dir \
  --output-format json \
  --chunk-by month
```

Notes:
- Chunking requires `--output` to be a directory.
- Default collision behavior is fail-fast if a chunk filename already exists.
- Use `--overwrite` only when you intentionally want to replace existing chunk files.

### 2) Incremental runs (dedup)

When re-exporting the same chat over time, dedup against a previous unified export:

```bash
bun run src/cli/index.ts convert \
  --input <path> \
  --platform <PLATFORM> \
  --output out.json \
  --dedup-against prior_export.json
```

You can also point `--dedup-against` at a directory of `*.json` exports.

### 3) Choose the right JSON shape

- Default JSON output is the canonical wrapper `{ meta, chat_info, messages: [...] }`.
- For strict downstream consumers, use `--output-profile minimal` (root JSON array).

```bash
bun run src/cli/index.ts convert \
  --input <path> \
  --platform <PLATFORM> \
  --output out.json \
  --output-format json \
  --output-profile minimal
```

### 4) Collect a machine-readable run report

For large exports, prefer auditing via `--report-json` rather than inspecting the full output:

```bash
bun run src/cli/index.ts convert \
  --input <path> \
  --platform <PLATFORM> \
  --output out.json \
  --report-json report.json \
  --quiet
```

The report includes:
- timings and counts
- dedup stats (if enabled)
- warning counts (useful with `--lenient`)

## Lenient Mode (Best-Effort Parsing)

`--lenient` enables adapter-specific best-effort behavior (warn/skip/continue when feasible).

Current baseline support:
- WhatsApp `.txt`: invalid timestamp header-like lines emit a warning and are treated as message continuation.

## Expected Resource Profile (High-Level)

- Memory usage is intended to stay relatively stable even for large exports.
- Disk usage depends on:
  - output size (especially in canonical JSON)
  - chunking (more files, similar total bytes)
  - dedup indexes (stores message IDs on disk)

## Safety

Never commit real exports, databases, or tokens.

See: [OPEN_SOURCE_SAFETY.md](OPEN_SOURCE_SAFETY.md)
