
# Open Chat Exporter (Standalone / Sibling Project Spec)

## Project Overview
Before building the Sovereign App (which requires strictly structured data), we are first building the "Open Chat Exporter." This is a standalone, fully open-source utility designed to solve the universal AI "ingestion problem." It takes raw, messy chat exports from various communication platforms and normalizes them into clean, structured formats suitable for LLMs, RAG pipelines, or direct analysis.

**Open Source Strategy (Build vs. Borrow):**
As a dedicated open-source project, we can learn from and reference existing community tools (like `DiscordChatExporter` in C#, `imessage-exporter` in Rust, or `WhatsApp-Chat-Exporter` in Python). However, to prevent a fragmented architecture requiring multiple language runtimes, we will **borrow the parsing logic/regex/schemas** from these projects, but **build the actual adapters natively** in our chosen unified tech stack. This ensures the exporter remains a fast, lightweight, and easily deployable tool.

**Goal:** Allow users to export a WhatsApp `.txt` file, a Discord `.json` dump, or an iMessage SQLite export, scrub it for privacy, and output a clean unified format (JSON, Markdown, CSV).

**V1 Scope (Roadmap):** Implement through Phase 22 (chunking, incremental dedup, and WhatsApp Android DB reply-aware import). Additional mobile ecosystem adapters (Signal/WeChat/Line/KakaoTalk/Viber) are deferred to a later version.

## 1. Technical Architecture: The Pipeline

### A. The Input Adapters (Parsers)
The system will use a plug-and-play adapter model. Each adapter is responsible for parsing a specific platform's native export format and mapping it to our internal unified schema.

**Core Adapters:**
*   **WhatsApp:** Parses standard `.txt` export logs (handling edge cases around timestamps, systemic messages like "deleted this message", and multiline texts).
*   **Telegram:** Parses the Telegram desktop `result.json` export.
*   **Discord:** Parses offline JSON exports (e.g., DiscordChatExporter-style JSON or platform exports).
*   **Slack:** Parses Slack export JSON files that contain message arrays (typically per-channel/per-day files). Note: full workspace exports are often **admin/owner-gated**, so the CLI targets single message JSON files rather than requiring whole-workspace access.
*   **iMessage:** Imports a local `chat.db` SQLite file from macOS Messages (user-accessible on macOS). Requires selecting a chat via `chat.guid` (CLI: `--chat-guid`); iOS backups and device-forensics flows remain out-of-scope for the baseline adapter.

**Mobile / Ecosystem Adapters (Future):**
*   **Signal:** Parses the decrypted backup format (requires user to provide passphrase).
*   **WeChat:** Parses the exported chat history databases.
*   **Line:** Parses the native `.txt` chat backup files.
*   **KakaoTalk:** Parses the `.txt` or `.csv` export formats.
*   **Viber:** Parses the `.csv` or `.zip` export logs.

**Social Media / Enterprise Adapters (Future):**
*   **Facebook Messenger / Instagram Direct:** Parses the JSON data exports provided via Meta's "Download Your Information" tool.
*   **Google Chat / Hangouts:** Parses the JSON files from Google Takeout.
*   **Microsoft Teams:** Parses user data exports from Microsoft compliance or privacy dashboard.
*   **Snapchat:** Parses the `chat_history.json` from Snapchat's "My Data" download.
*   **X (Twitter) DMs:** Parses the `direct-messages.js` file from the X data archive.
*   **Skype:** Parses the `messages.json` file exported from Skype data download.
*   **LinkedIn Messaging:** Parses the `messages.csv` export from the LinkedIn data privacy archive.

### Export Accessibility (Reality Check)
In practice, the best V1 adapters target artifacts that a **regular user** can obtain without admin roles, device rooting/jailbreaking, or compliance tooling.

**Generally user-accessible (self-serve downloads):**
* WhatsApp `.txt` chat exports
* Telegram desktop export (`result.json`)
* Meta exports (Facebook Messenger / Instagram) via "Download Your Information"
* Google Takeout exports (Google Chat)
* Snapchat "My Data" export (`chat_history.json`)
* X/Twitter data archive (`direct-messages.js`)
* LinkedIn data export (`messages.csv`)
* Skype data export (`messages.json`)

**Often gated / harder:**
* Slack full workspace exports are frequently **owner/admin** gated; DM coverage varies by workspace settings. Prefer parsing the smallest exported message JSON files when available.
* Microsoft Teams exports may require Microsoft 365 compliance/eDiscovery access, depending on tenant and settings.

**Device/ecosystem dependent:**
* iMessage is most accessible via macOS Messages `chat.db` on a Mac with Messages enabled; iOS backups/device extraction flows are significantly more complex.

### WhatsApp Reply Context (TXT Limitation + DB Import Paths)
The baseline WhatsApp adapter targets the user-exportable `.txt` file, but that format does **not** reliably preserve reply/quote relationships. This means we often cannot populate `context.reply_to_message_id` from `.txt` alone.

**Inspiration (iMazing):** iMazing’s WhatsApp export workflow is built around pulling WhatsApp data from an iTunes/iMazing iOS backup (including encrypted backups), then exporting in multiple formats (PDF/CSV/TXT/RSMF) with rich metadata. For our purposes, the key takeaway is: **the reply graph is only recoverable when you ingest WhatsApp’s underlying databases**, not the UI-oriented `.txt` export.

**Approach for reply-aware WhatsApp imports:**
* **iOS backup path (Implemented):** an adapter reads an extracted WhatsApp iOS chat database (`ChatStorage.sqlite`) from a decrypted iOS backup (user supplies the extracted DB file path). It uses the database’s quote/reply reference fields to map each message to its replied-to message and set `context.reply_to_message_id` (best-effort).
* **Android DB path (Implemented):** an adapter reads a decrypted msgstore-style SQLite database (e.g., `msgstore.db` or equivalent decrypted form). Same goal: map quote/reply references to `context.reply_to_message_id`.
* **Streaming-safe resolution:** if reply references use internal keys/row IDs, resolve them via:
	* a **two-pass** strategy that builds an on-disk lookup (SQLite temp table or KV file) from internal message key → unified `message_id`, then replays messages to fill `reply_to_message_id`, or
	* a **single-pass** strategy with a bounded cache (best-effort; unresolved replies become `null`).

**Non-negotiables still apply:** no full-db loads into memory; media remains excluded in V1 (only `metadata.has_attachment`).

### Meta (Facebook Messenger / Instagram) Reply Context (Research)
Meta’s **downloadable archives** ("Download Your Information" JSON/HTML) appear to be designed for human-readable history and analysis, and commonly include fields like `sender_name`, `timestamp_ms`, `content`, `reactions`, and media references — but **do not consistently expose a stable message ID + reply pointer** in a way that would let us populate `context.reply_to_message_id` with high confidence.

However, Meta’s **official Conversations API** for Messenger/Instagram business messaging *does* expose reply linkage at the API layer when you fetch message details: a message can include a `reply_to` object (with a message identifier like `mid` and an `is_self_reply` flag).

**Practical consequence:**
* For offline *"Download Your Information"* exports, `context.reply_to_message_id` will generally remain `null` (unless a future export schema is found that includes explicit reply references).
* For eligible Page / Instagram Professional account conversations, an **API-based adapter** could populate reply graphs — but this is **not a typical self-serve export** (requires tokens/app setup and has platform limitations, including only being able to query details for the most recent messages).

#### Phase 18 (Implemented, Optional): Meta Conversations API Adapter
This adapter is intentionally **separate** from offline Meta exports. It exists only to support reply graphs when Meta’s API exposes `reply_to`.

**How it’s invoked (CLI):**
* `--platform META_CONVERSATIONS_API`
* `--input <path>` points to a small **non-secret JSON config** (IDs + selection parameters)

**Auth / secrets (runtime env vars only):**
* `META_ACCESS_TOKEN` (required for live API calls)
* `META_GRAPH_API_VERSION` (optional; default is set by adapter)

**Config file (minimal contract):**
* `surface`: `FB_MESSENGER | INSTAGRAM` (sets `chat_info.platform`)
* `conversation_id`: string (required)
* Optional: `chat_name`, `since_utc`, `until_utc`, `limit`, `max_messages`, `max_enrich_requests`

**Reply mapping behavior:**
* Uses Meta message ID as `message_id`.
* When message details include `reply_to.mid`, sets `context.reply_to_message_id = reply_to.mid`.
* If reply details are missing/unavailable (common outside Meta’s “recent message” window), falls back to `null`.

**Testability (no real tokens/exports):**
* Smoke tests run in a **fixture mode** via `META_API_FIXTURE_DIR` to avoid network calls and avoid requiring credentials.

### B. The Internal Unified Schema
Regardless of where the data came from, it is mapped into a strict internal representation designed to preserve critical conversational context while minimizing token bloat.

**Authoritative schema:** `03_unified_schema_definition.md`

**Export wrapper (one per export):**
*   `export_meta`: `{ version, exporter_version, exported_at }`
*   `chat_info`: `{ platform, chat_name, chat_type, participant_count? }`
*   `messages`: `IUnifiedMessage[]` (flat array)

**Message object (one per message):**
*   `message_id` (String, Discord native ID or deterministic generated hash)
*   `timestamp_utc` (ISO 8601 UTC string)
*   `sender`: `{ id, original_name, resolved_name? }`
*   `content` (String, raw body text; rich text flattened to Markdown)
*   `context`: `{ reply_to_message_id, thread_id?, forwarded_from? }`
*   `interactions`: `{ reactions[] }` (optional)
*   `metadata`: `{ has_attachment, is_edited, is_deleted, is_system }`

This intentionally avoids repeating `platform` and `chat_name` on every message to reduce JSON size and LLM context waste.

### C. The Scrubbing & Pre-Processing Engine
Give the user local, absolute command over the data before it's finalized.
*   **Identity Resolution & Merging:** A configuration system (`identities.yaml`) that maps disparate handles to a single entity (e.g., merging `+1-555...` on WhatsApp and `Sarah#1234` on Discord to `[User_Sarah]`). This is vital for cross-platform model coherence.
*   **Anonymization Engine:** Search and replace specific names with placeholders like `[User_A]` or `[User_B]` to ensure privacy before sending to an LLM.
*   **Data Cleanup:** Strip out attachment placeholders (e.g., `<Media omitted>`), remove system messages, or drop extremely short messages (e.g., "ok", "k").
*   **Time-Boxing:** Select specific date ranges for export.
*   **Deduplication (Incremental Exports):** By hashing existing `message_id`s, users can run `chat-export convert --since last_run` to only ingest net-new messages without duplicating vector DB entries.

#### Phase 21 (Implemented): Incremental Export + Deduplication
This phase adds streaming-safe deduplication to support repeated runs without duplicating messages.

**CLI additions (contract):**
* `--dedup-against <path>`
	* `<path>` may be a unified export JSON file, or a directory containing `*.json` unified export files (e.g., Phase 20 chunk outputs).
	* Dedup is performed on `message_id` only.
	* The exporter produces a **delta export** (net-new messages only); it does not append/merge into the prior export.

**Streaming constraint:** indexing prior exports must be streaming-safe (no buffering `messages[]`).

### D. The Output Formats & Chunking
The final payload can be downloaded in formats highly optimized for AI workflows, with built-in awareness of LLM context limits:
*   **Automated Context Chunking (Phase 20):** Huge chat histories can be sliced by time boundaries (day/month) into multiple files so they don't break LLM context limits when copy-pasted. Token-count chunking is deferred until we can define it deterministically and streaming-safe.
*   **Clean Markdown (`.md`):** E.g., `**[User_A] (14:32)**: Here we go again.` Includes inline context for reactions and thread replies (perfect for pasting into ChatGPT/Claude).
*   **Structured JSON (`.json`):** A root wrapper object (`export_meta`, `chat_info`, `messages`) matching `03_unified_schema_definition.md`. (Perfect for the Sovereign GraphRAG backend).
*   **CSV / TSV:** For manual spreadsheet analysis.

#### Phase 19 (Implemented): Streaming Scrubbing + Markdown/CSV Writers
This phase adds a streaming scrub step (identity resolution + optional anonymization + filters) and adds two additional output writers.

**CLI additions (contract):**
* `--output-format <fmt>` where `<fmt>` is `json | md | csv` (default: `json`).
* `--output-profile <profile>` where `<profile>` is `canonical | messages-array | minimal` (default: `canonical`).
	* `canonical` emits the authoritative wrapper schema from `03_unified_schema_definition.md`.
	* `messages-array` emits a root JSON array of unified message objects (same fields as `messages[]`).
	* `minimal` emits a root JSON array of minimal message objects for strict downstream validators:
		* `platform`, `timestamp_utc`, `sender_name`, `message_content`
* `--identities <path>` path to `identities.yaml` (see `03_unified_schema_definition.md`).
* `--anonymize` when set, replaces alias occurrences in `content` with `sender.resolved_name` (best-effort).
* `--report-json <path>` writes a small machine-readable run report (messages emitted, dedup stats, timings).
* `--quiet` suppresses non-error stderr output (e.g., dedup summary).
* Optional streaming-safe filters:
	* `--since-utc <iso>` / `--until-utc <iso>`
	* `--drop-system` (omit `metadata.is_system === true`)
	* `--min-content-length <n>` (omit very short messages)

**Writer behavior (minimal/stable):**
* `json` remains the authoritative unified export wrapper (`export_meta`, `chat_info`, `messages[]`).
* `md` is human/LLM friendly and ordered chronologically.
* `csv` is analysis friendly and uses a stable header + proper escaping.

**Non-negotiable constraint:** scrub + writers must operate on an `AsyncGenerator` stream; never buffer `messages[]` in memory.

#### Phase 20 (Implemented): Output Chunking (Time-Based)
This phase adds **time-based chunking** for `json` and `md` outputs without buffering `messages[]`.

**CLI additions (contract):**
* `--chunk-by <none|day|month>` (default: `none`).
* `--overwrite` (optional): when set, chunk files may be replaced if they already exist.

**Directory-mode output contract:**
* If `--chunk-by` is not `none`, then `--output` is required and is treated as a **directory path**.
* Chunking to stdout is not supported.
* The output directory is created recursively if it does not exist.
* If the output path exists and is a file: error.

**Chunk boundaries:**
* Chunk key is derived from `timestamp_utc` in UTC:
	* `month`: `YYYY-MM`
	* `day`: `YYYY-MM-DD`

**File naming (non-PII, collision-resistant):**
* Filenames use: `<platform>.<chatId>.chunk.<chunkKey>.<ext>`
* `chatId` is a short prefix of `sha256(platform + "\n" + chat_type + "\n" + chat_name)`.

**Collision policy:**
* Default: fail-fast if a target chunk file already exists.
* If `--overwrite` is set: existing chunk files may be replaced.

## 2. Red Team Analysis & Risk Mitigation (Failure Modes)
Before executing on the tech stack, we proactively "Red Teamed" the spec to find architectural vulnerabilities, edge cases, and catastrophic failure modes:

### Vulnerability 1: The OOM (Out Of Memory) Crash
*   **Attack Vector:** Discord data package dumps and deeply nested Telegram `result.json` files can easily exceed 5GB+. Standard parsers reading the entire payload into memory mapping (`JSON.parse()`) will instantly trigger OOM crashes, especially on older consumer laptops.
*   **Mitigation Strategy:** The core engine MUST use **streaming parsers** (e.g., pulling JSON tokens or reading Line-by-Line `BufReader`) rather than loading entire files into memory.

### Vulnerability 2: The "Brittle Regex" Trap (Platform Locale Chaos)
*   **Attack Vector:** WhatsApp `.txt` exports change their timestamp formats entirely based on the user's OS Language and Regional settings (e.g., `DD/MM/YYYY` vs `MM/DD/YY`, or `14:30` vs `2:30 PM`). A rigid regex for parsing the start of a message will silently fail, dropping thousands of texts or merging multiple texts into one monstrous blob.
*   **Mitigation Strategy:** The parser must implement a localized datetime heuristic engine (like `dateparser` in Python or `chrono` in Rust) or pre-flight the document to auto-detect the locale fingerprint of the specific file before bulk parsing.

### Vulnerability 3: Anonymization Bypass (The Privacy Leak)
*   **Attack Vector:** Simple string replacement (`Chirag` -> `User_A`) fails on possessives (`Chirag's`), misspellings (`chriag`), Unicode characters (`Chirãg`), or when names are split across line breaks. If PII leaks into the final Markdown and is pasted into OpenAI, it violates the privacy goal.
*   **Mitigation Strategy:** The Anonymization Engine needs an aggressive, optional NLP/NER (Named Entity Recognition) pass, or a strict regex boundary system (`\bName\b`) coupled with a dictionary of known aliases (e.g., `contacts.yaml` handles arrays of misspellings per identity).

### Vulnerability 4: The Base64 Media Bloat (LLM Threat)
*   **Attack Vector:** Taking a WhatsApp chat with 100 images, Base64-encoding them, and injecting them into the JSON will yield a 300MB text file that no LLM can process, causing an immediate crash or token limit error.
*   **Mitigation Strategy:** Media extraction and embedding features are explicitly excluded from V1. The pipeline will only register a `has_attachment: true` boolean and strip the actual media. We may revisit this later as LLM multimodal context windows expand.

### Vulnerability 5: API Bans vs. GDPR Exports
*   **Attack Vector:** "Scraping" Discord or Slack via undocumented API calls using user tokens (Self-botting) violates their Terms of Service and will ban the user's account permanently.
*   **Mitigation Strategy:** The adapters must explicitly state they only parse **Offline Data Dumps** (e.g., Discord "Request My Data", Slack workspace exports) and never perform live credentialed API scraping.

## 3. Tech Stack Final Decision: TypeScript (V1) -> Rust (V2)
Given the goal of maximum utility—acting as a standalone CLI tool that anyone can use to extract structured data (`.csv`, `.json`, `.md`)—we must select a language that balances developer speed, parsing performance (handling 5GB files), and easy distribution.

**The Strategy: The "JavaScript Trojan Horse"**
We have decided to build **V1 of the Open Chat Exporter in TypeScript** (compiled to a standalone executable via **Bun** or **Deno**). Once the project gains traction, we will rewrite the ultra-high-performance parsing core in **Rust** for V2.

### Why TypeScript First?
1. **Massive Open Source Talent Pool:** TypeScript is the lingua franca of the web. Finding 20 open-source contributors to write parsers for KakaoTalk, Viber, and Snapchat is profoundly easier in TS than in Rust.
2. **Development Velocity:** Prototyping dirty RegEx and parsing horrific, unstructured JSON dumps from Discord is incredibly fast in JavaScript.
3. **The Web UI / Tauri Share:** Building the core logic in TypeScript means we can share 100% of our schema models and parsing functions natively with a future React-based Web App or Tauri desktop GUI.

### Why Rust Later? (The Trade-offs we are accepting for V1)
1. **The V8 Memory Tax (OOM Risk):** JavaScript is garbage-collected via the V8 engine. It uses significantly more RAM than Rust. We must be exceptionally disciplined about *streaming* files (using `fs.createReadStream` or similar) instead of loading a 5GB JSON file into memory, otherwise the V1 app will crash.
2. **Bloated Binaries:** A "Hello World" Rust binary is 3MB. A Bun/Deno compiled TypeScript executable bundles the entire JS engine inside, meaning our simple CLI app might be a 50MB download for users.
3. **True Multithreading:** JavaScript relies on clunky Web Workers for parallel processing, making it harder to parse 50 WhatsApp backup files across 8 CPU cores simultaneously compared to Rust's native threading.

By choosing TypeScript for V1, we optimize for speed-to-market and community growth. By planning for Rust in V2, we secure the project's long-term enterprise viability.

## 4. How this bridges to Sovereign
The output of this Open Chat Exporter (specifically the JSON format) will become the exact, required input schema for the Sovereign AP Framework App. By decoupling the messy parsing logic from the AI analysis logic, both projects become exponentially easier to build and maintain.