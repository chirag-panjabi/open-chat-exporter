# AI Agent Memory & Lessons Learned
**Last Updated:** May 4, 2026

## What We Did Wrong:
*   We incorrectly assumed we could reverse-engineer WhatsApp threads from `.txt` exports. We discovered the platform entirely drops quotes/replies from external UI elements inside the raw `.txt`.
    *   **Lesson:** Never presume graphical UI contexts implicitly exist inside data exports. Platforms sanitize. We must rely strictly on APIs/DBs or accept data loss.
*   We assumed we could utilize `WhatsApp-Chat-Exporter` verbatim. Found out it's python, which breaks our Standalone TypeScript build dependency goal (which enables browser/desktop use without pip installs).
    *   **Lesson:** Build the core logic natively. Read open-source repos for their Logic/SQL Strings, but write the code in our TS app. Red Team the Tech Stack constantly.
*   We linted a synthetic `.js` fixture without declaring its browser global.
    *   **Lesson:** For JS-wrapped exports (e.g., X/Twitter), synthetic fixtures may include `window` and must declare `/* global window */` to keep ESLint strictness intact.

## Known Complexities to Watch Out For:
- **Timestamp Parsing Chaos:** `Date.parse()` in JS is notoriously fickle across different locales. We may need to explicitly use a robust library like `dayjs` or `date-fns` when dealing with international data dumps from WhatsApp or Line.
- **iMessage Timestamp Units:** macOS Messages `chat.db` stores timestamps relative to Apple epoch (2001-01-01), but the unit can vary (seconds/ms/us/ns) across OS versions and schemas. Use a magnitude-based heuristic and always normalize to ISO 8601 UTC.
- **WhatsApp iOS DB Schema Drift:** Reply/quote linkage columns can move between `ZWAMESSAGE` and a joined table (e.g. `ZWAMESSAGEINFO`), or be absent depending on app/OS version.
    - **Lesson:** Introspect tables/columns at runtime and implement best-effort fallbacks; avoid hardcoding a single schema.
- **WhatsApp iOS Cocoa Timestamps:** WhatsApp iOS message dates are seconds (often float) since Apple epoch (2001-01-01). Normalize by converting to Unix ms and emitting ISO 8601 UTC.
- **Streaming-Safe Reply Resolution:** Some reply linkage uses stanza IDs instead of direct quoted message PKs.
    - **Lesson:** Use a two-pass strategy with an on-disk index (stanza_id → pk) to stay streaming-safe and avoid buffering messages.
- **OOM Crashes:** Do not ever use `fs.readFileSync` or `await file.text()` or `JSON.parse(wholeFileString)` anywhere in the `.ts` files. It will explode on Discord or Telegram dumps. Stream it chunked. Always.
- **Streaming Scrub/Output:** Scrubbing (identity resolution/anonymization) and Markdown/CSV writers must operate on an `AsyncGenerator` stream; avoid buffering the full messages array for formatting.
- **TypeScript + `stream-json` imports:** With our TS config (`moduleResolution: bundler` + package `exports`), subpath imports may require the explicit `.js` suffix (e.g. `stream-json/parser.js`, not `stream-json/parser`) to resolve correctly.
- **Export Accessibility:** Some platforms' "full" exports are admin/compliance gated (e.g., Slack workspace exports, Teams compliance exports). Prefer adapters that accept the smallest user-accessible artifact (single exported file) before adding folder/workspace-level support.
- **Bun compiled argv quirks:** Standalone executables built via `bun build --compile` may still expose `bun`/entrypoint-like values in `process.argv`. Avoid trying to infer the invocation string in `--help`; instead, document both source-run and standalone executable usage patterns explicitly.
