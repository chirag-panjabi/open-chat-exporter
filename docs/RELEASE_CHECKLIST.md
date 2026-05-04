# Release Checklist (V1)

This checklist is intentionally short and optimized for safety (no PII leakage) and reproducibility.

## Pre-flight

- Confirm you are in the correct repo and branch.
- Confirm you are not using any real exports/DBs/tokens in the workspace.

## Safety: Prevent Leaking Sensitive Data

- `git status` should not show any real exports, databases, backups, keys, or `.env` files.
- Review ignore rules: [OPEN_SOURCE_SAFETY.md](OPEN_SOURCE_SAFETY.md)
- Before committing:
  - `git diff`
  - `git diff --staged`

## Validate

Run the full verification set:

```bash
bun run typecheck
bun run lint
bun run test
```

If you are shipping the standalone executable path:

```bash
bun run build:exe
./dist/open-chat-exporter-<os>-<arch> --help

# Quick IPC smoke (stderr JSONL events; synthetic fixture only)
./dist/open-chat-exporter-<os>-<arch> convert \
  --input tests/fixtures/whatsapp/whatsapp_lenient_invalid_timestamp.sample.txt \
  --platform WHATSAPP \
  --output /tmp/out.json \
  --output-format json \
  --output-profile minimal \
  --lenient \
  --log-format jsonl \
  2> /tmp/run.events.jsonl
```

Notes:
- JSONL logging contract: [LOG_FORMAT_JSONL.md](LOG_FORMAT_JSONL.md)
- Tests must remain **synthetic-fixture-only** (no real exports).
- Avoid adding tests that require network access or secrets.

## Versioning

- Bump `package.json` version using semver (when we start publishing):
  - `major`: breaking schema/API changes
  - `minor`: new adapters/features
  - `patch`: fixes

## Final Steps

- Ensure working tree is clean: `git status --porcelain`
- Create the tag/release (process depends on packaging choice in R1).
