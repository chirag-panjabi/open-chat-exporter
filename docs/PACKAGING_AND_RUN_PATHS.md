# Packaging & Run Paths (V1)

## Decision (V1)

**V1 is source-first.** The supported and tested execution path is running the CLI from source using **Bun**.

A single-file binary build can be explored later, but it is not the primary supported distribution path in V1.

## Supported Run Paths

### 1) Run the CLI from source (recommended)

```bash
bun install

# Help
bun run src/cli/index.ts --help

# Convert
bun run src/cli/index.ts convert \
  --input <path> \
  --platform <PLATFORM> \
  --output out.json
```

Convenience script:

```bash
bun run cli --help
```

### 2) Use as a library (in-process)

This repo exposes stable entrypoints via `package.json` `exports`:

- `unified-chat-exporter` (core entrypoint)
- `unified-chat-exporter/sdk` (adapter creation helpers)
- `unified-chat-exporter/types` (TypeScript types)

How you consume it depends on your setup:
- Within a monorepo/workspace, add it as a workspace dependency.
- For internal use, you can vendor the repo and import via the above export paths.

## Notes

- For very large exports, prefer file output + chunking; see [LARGE_EXPORT_GUIDE.md](LARGE_EXPORT_GUIDE.md).
- Keep the repo clean of PII; see [OPEN_SOURCE_SAFETY.md](OPEN_SOURCE_SAFETY.md).
