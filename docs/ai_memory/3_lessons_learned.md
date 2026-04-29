# AI Agent Memory & Lessons Learned
**Last Updated:** April 22, 2026

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
- **OOM Crashes:** Do not ever use `fs.readFileSync` or `await file.text()` or `JSON.parse(wholeFileString)` anywhere in the `.ts` files. It will explode on Discord or Telegram dumps. Stream it chunked. Always.
- **Streaming Scrub/Output:** Scrubbing (identity resolution/anonymization) and Markdown/CSV writers must operate on an `AsyncGenerator` stream; avoid buffering the full messages array for formatting.
- **TypeScript + `stream-json` imports:** With our TS config (`moduleResolution: bundler` + package `exports`), subpath imports may require the explicit `.js` suffix (e.g. `stream-json/parser.js`, not `stream-json/parser`) to resolve correctly.
- **Export Accessibility:** Some platforms' "full" exports are admin/compliance gated (e.g., Slack workspace exports, Teams compliance exports). Prefer adapters that accept the smallest user-accessible artifact (single exported file) before adding folder/workspace-level support.
