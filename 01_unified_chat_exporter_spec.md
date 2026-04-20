
# Unified Chat Exporter (Standalone / Sibling Project Spec)

## Project Overview
Before building the Sovereign App (which requires strictly structured data), we are first building the "Unified Chat Exporter." This is a standalone, fully open-source utility designed to solve the universal AI "ingestion problem." It takes raw, messy chat exports from various communication platforms and normalizes them into clean, structured formats suitable for LLMs, RAG pipelines, or direct analysis.

**Open Source Strategy (Build vs. Borrow):**
As a dedicated open-source project, we can learn from and reference existing community tools (like `DiscordChatExporter` in C#, `imessage-exporter` in Rust, or `WhatsApp-Chat-Exporter` in Python). However, to prevent a fragmented architecture requiring multiple language runtimes, we will **borrow the parsing logic/regex/schemas** from these projects, but **build the actual adapters natively** in our chosen unified tech stack. This ensures the exporter remains a fast, lightweight, and easily deployable tool.

**Goal:** Allow users to export a WhatsApp `.txt` file, a Discord `.json` dump, or an iMessage SQLite export, scrub it for privacy, and output a clean unified format (JSON, Markdown, CSV).

## 1. Technical Architecture: The Pipeline

### A. The Input Adapters (Parsers)
The system will use a plug-and-play adapter model. Each adapter is responsible for parsing a specific platform's native export format and mapping it to our internal unified schema.

**Core Adapters:**
*   **WhatsApp:** Parses standard `.txt` export logs (handling edge cases around timestamps, systemic messages like "deleted this message", and multiline texts).
*   **Telegram:** Parses the Telegram desktop `result.json` export.
*   **Discord / Slack:** Parses their native JSON dumps.

**Mobile / Ecosystem Adapters (Future):**
*   **iMessage:** Connects to or imports a local `chat.db` SQLite file.
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

### B. The Internal Unified Schema
Regardless of where the data came from, it is mapped into this strict internal representation. This schema is designed to preserve critical conversational context (threads, rooms, and reactions) for LLMs:
*   `message_id` (String, generated hash or native ID for deduplication)
*   `platform` (String: WHATSAPP, IMESSAGE...)
*   `chat_name` / `room_name` (String, e.g., "Family Group", "Engineering Channel")
*   `chat_type` (Enum: DIRECT, GROUP, CHANNEL)
*   `timestamp_utc` (ISO 8601 string)
*   `sender_id` / `sender_name` (String)
*   `receiver_id` / `receiver_name` (String, if applicable)
*   `reply_to_message_id` (String, linking to parent message for threading)
*   `message_content` (String, raw body text)
*   `reactions` (Array of objects: `[{emoji: "👍", sender: "User_B"}]`)
*   `has_attachment` (Boolean) - *Note: Actual media extraction/embedding is reserved for a future release to prevent context bloat and out-of-memory errors.*
*   `is_edited` (Boolean)
*   `system_message` (Boolean - true if it's "User joined the group")

### C. The Scrubbing & Pre-Processing Engine
Give the user local, absolute command over the data before it's finalized.
*   **Identity Resolution & Merging:** A configuration system (`contacts.yaml` or CLI args) that maps disparate handles to a single entity (e.g., merging `+1-555...` on WhatsApp and `Sarah#1234` on Discord to `[User_Sarah]`). This is vital for cross-platform model coherence.
*   **Anonymization Engine:** Search and replace specific names with placeholders like `[User_A]` or `[User_B]` to ensure privacy before sending to an LLM.
*   **Data Cleanup:** Strip out attachment placeholders (e.g., `<Media omitted>`), remove system messages, or drop extremely short messages (e.g., "ok", "k").
*   **Time-Boxing:** Select specific date ranges for export.
*   **Deduplication (Incremental Exports):** By hashing existing `message_id`s, users can run `chat-export convert --since last_run` to only ingest net-new messages without duplicating vector DB entries.

### D. The Output Formats & Chunking
The final payload can be downloaded in formats highly optimized for AI workflows, with built-in awareness of LLM context limits:
*   **Automated Context Chunking:** Huge chat histories are automatically sliced by time (e.g., monthly files like `chat_2024_01.md`) or by token count (e.g., using `tiktoken` to slice at exactly 100k tokens) so they don't break LLM context limits when copy-pasted.
*   **Clean Markdown (`.md`):** E.g., `**[User_A] (14:32)**: Here we go again.` Includes inline context for reactions and thread replies (perfect for pasting into ChatGPT/Claude).
*   **Structured JSON (`.json`):** An array of objects matching the internal schema. (Perfect for the Sovereign GraphRAG backend).
*   **CSV / TSV:** For manual spreadsheet analysis.

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
We have decided to build **V1 of the Unified Chat Exporter in TypeScript** (compiled to a standalone executable via **Bun** or **Deno**). Once the project gains traction, we will rewrite the ultra-high-performance parsing core in **Rust** for V2.

### Why TypeScript First?
1. **Massive Open Source Talent Pool:** TypeScript is the lingua franca of the web. Finding 20 open-source contributors to write parsers for KakaoTalk, Viber, and Snapchat is profoundly easier in TS than in Rust.
2. **Development Velocity:** Prototyping dirty RegEx and parsing horrific, unstructured JSON dumps from Discord is incredibly fast in JavaScript.
3. **The Web UI / Tauri Share:** Building the core logic in TypeScript means we can share 100% of our schema models and parsing functions natively with a future React-based Web App or Tauri desktop GUI.

### Why Rust Later? (The Trade-offs we are accepting for V1)
1. **The V8 Memory Tax (OOM Risk):** JavaScript is garbage-collected via the V8 engine. It uses significantly more RAM than Rust. We must be exceptionally disciplined about *streaming* files (using `fs.createReadStream` or similar) instead of loading a 5GB JSON file into memory, otherwise the V1 app will crash.
2. **Bloated Binaries:** A "Hello World" Rust binary is 3MB. A Bun/Deno compiled TypeScript executable bundles the entire JS engine inside, meaning our simple CLI app might be a 50MB download for users.
3. **True Multithreading:** JavaScript relies on clunky Web Workers for parallel processing, making it harder to parse 50 WhatsApp backup files across 8 CPU cores simultaneously compared to Rust's native threading.

By choosing TypeScript for V1, we optimize for speed-to-market and community growth. By planning for Rust in V2, we secure the project's long-term enterprise viability.

## 3. How this bridges to Sovereign
The output of this Unified Chat Exporter (specifically the JSON format) will become the exact, required input schema for the Sovereign AP Framework App. By decoupling the messy parsing logic from the AI analysis logic, both projects become exponentially easier to build and maintain.