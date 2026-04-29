# Open Source Safety (What must never enter the repo)

This project processes **highly sensitive** personal data (chat logs, backups, contact names, phone numbers). Even one accidental commit can permanently leak PII.

## Never commit
- Chat exports and datasets (WhatsApp/Telegram/Discord dumps)
- macOS Messages databases (e.g., `~/Library/Messages/chat.db`) and attachments (`~/Library/Messages/Attachments/`)
- iOS backups / extracted files (e.g., `ChatStorage.sqlite`, `Manifest.db`)
- Android WhatsApp databases and keys (e.g., `msgstore.db.crypt*`, `wa.db`, `key`)
- Any `.env` files, certificates, or API keys
- Any API access tokens (e.g., `META_ACCESS_TOKEN`) or recorded responses containing real IDs

## How we prevent leaks
- `.gitignore` blocks common export/database/key patterns.
- Keep local data in one of these ignored folders:
  - `data/`
  - `exports/`
  - `private/`

## How to sanity-check before pushing
- Run `git status` and confirm no export/db/key files are staged.
- Use `git diff --staged` before every commit.

## Test fixtures policy
- Only use **synthetic** fixtures in `tests/`.
- Avoid real-looking phone numbers/emails; use clearly fake placeholders.
- Prefer a **fixture directory mode** for any API-backed adapter tests so CI never needs network or secrets.
