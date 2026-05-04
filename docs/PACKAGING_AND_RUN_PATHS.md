# Packaging & Run Paths (V1)

## Decision (V1)

**V1 supports standalone executables.** The primary integration path for consumer apps (e.g., Sovereign) is running a compiled, zero-dependency binary built via `bun build --compile`.

Running the CLI from source using **Bun** remains supported for development.

## Supported Run Paths

### 1) Standalone executable (recommended for consumer apps)

Build (outputs to `dist/`, which is gitignored):

```bash
bun install
bun run build:exe
```

Run:

```bash
./dist/open-chat-exporter-<os>-<arch> --help
./dist/open-chat-exporter-<os>-<arch> convert --input <path> --platform <PLATFORM> --output out.json

# For host-app IPC integration, emit structured stderr events:
./dist/open-chat-exporter-<os>-<arch> convert ... --log-format jsonl 2> run.events.jsonl
```

Notes:
- JSONL logging is documented in: [LOG_FORMAT_JSONL.md](LOG_FORMAT_JSONL.md)

Build script options:

```bash
# Customize output directory/name
bun run build:exe --outdir dist --name open-chat-exporter

# On Windows, optional GUI-friendly build (hides console window)
bun run build:exe --windows-hide-console
```

Hermetic defaults:
- The build disables autoloading of `.env`, `bunfig.toml`, `package.json`, and `tsconfig.json` at runtime.

Note on multi-arch:
- `bun build --compile` builds for the **current** OS/arch. To produce macOS arm64/x64 and Windows x64 binaries, build on each target (e.g., CI matrix).

### 2) Run the CLI from source (dev)

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

### 3) Use as a library (in-process)

This repo exposes stable entrypoints via `package.json` `exports`:

- `open-chat-exporter` (core entrypoint)
- `open-chat-exporter/sdk` (adapter creation helpers)
- `open-chat-exporter/types` (TypeScript types)

How you consume it depends on your setup:
- Within a monorepo/workspace, add it as a workspace dependency.
- For internal use, you can vendor the repo and import via the above export paths.

## Notes

- For very large exports, prefer file output + chunking; see [LARGE_EXPORT_GUIDE.md](LARGE_EXPORT_GUIDE.md).
- Keep the repo clean of PII; see [OPEN_SOURCE_SAFETY.md](OPEN_SOURCE_SAFETY.md).
