# Unified Chat Exporter - Architecture Decisions Log

Below is the chronological log of architecture and design decisions made for the Unified Chat Exporter project. It captures the *what* and the *why* of key choices as the project evolves.

---

### Decision 1: Project Scope - Unified Schema & Goal
**Date:** April 20, 2026
**Decision:** Build a standalone, open-source CLI utility ("Unified Chat Exporter") to normalize messy communication exports (WhatsApp, Discord, iMessage, etc.) into clean, structured formats (JSON, Markdown) for LLM ingestion, RAG pipelines, or direct analysis.
**Reason:** Currently, AI developers have to write custom parsers for every platform or rely on clunky, fragmented data analysis tools that aren't natively designed for AI context windows.

### Decision 2: Expansive Platform Support
**Date:** April 20, 2026
**Decision:** Target an exhaustive list of global platforms: WhatsApp, Telegram, Discord, Slack, iMessage, Signal, WeChat, Line, KakaoTalk, Viber, Facebook Messenger, Instagram Direct, Google Chat, Microsoft Teams, Snapchat, X (Twitter), Skype, and LinkedIn.
**Reason:** Assure maximum open-source utility and widespread adoption globally, beyond just Western or developer-centric walled gardens.

### Decision 3: Open Source Strategy (Build vs. Borrow)
**Date:** April 20, 2026
**Decision:** We will **borrow** the parsing logic, RegEx clues, and schema layouts from existing top-tier open-source parsers (like C# `DiscordChatExporter` or Rust `imessage-exporter`), but we will **build** the actual adapters natively in our own tech stack.
**Reason:** 1) Avoid inheriting GPL licensing risks that restrict commercial usage (SaaS). 2) Eliminate the need for a fragmented architecture where users have to install Python, Rust, and .NET runtimes just to run different adapters.

### Decision 4: Advanced LLM Context Preservation
**Date:** April 20, 2026
**Decision:** Expanded the internal schema to mandate Context Threading (`reply_to_message_id`, `reactions`), Identity Resolution (mapping cross-platform aliases to a core entity), Chat Types (`GROUP`, `DIRECT`), Output Chunking (splitting large exports by token limit), and Deduplication (incremental syncing).
**Reason:** Blindly dumping text loses the flow. LLMs need threading metadata and unified IDs to comprehend who is speaking to whom over vast histories.

### Decision 5: Exclude Base64 Media Embeds (V1)
**Date:** April 20, 2026
**Decision:** Strip media from exports and only assert `has_attachment: true`, delaying any localized Base64 embedding logic or complex multimodal mappings to a future version.
**Reason:** Red Team analysis revealed that attaching 100 images as Base64 strings to a JSON/Markdown file will cause instant OOM (Out Of Memory) crashes or blow past LLM context windows.

### Decision 6: Tech Stack Finalization - TypeScript (V1) to Rust (V2)
**Date:** April 20, 2026
**Decision:** **TypeScript (via Bun or Deno)** is chosen for V1 (The Minimum Viable Product). We will eventually build the high-performance core in **Rust** as a future V2 iteration.
**Reason:** TypeScript offers massive developer velocity, an enormous open-source community for building the 15+ varied platform adapters, and flawless code sharing with a future web/Tauri UI. The tradeoff is memory consumption. Once V1 proves product-market fit, we will utilize Rust to achieve memory-safe perfection and lightning-fast processing for 5GB+ dumps. 

### Decision 8: Cross-Platform Schema Validation & Normalization Rules
**Date:** April 20, 2026
**Decision:** Updated the JSON schema after aggressively cross-examining it against 15+ different platform export formats (including Apple's proprietary SQLite structures, FB Messenger JSON arrays, and flat CSVs). Added strict normalization rules that the parsers must enforce: Deterministic ID generation (SHA-256) for flat-file platforms like WhatsApp to enable deduplication; mathematical conversions for Apple Mach Absolute Time and UNIX milliseconds to ISO 8601 UTC; array-flattening for Telegram's rich text objects into standard Markdown; and explicit mapping of Apple/SMS "is_from_me" Boolean values into dynamic user names via CLI flags. Added `context.forwarded_from`, `metadata.is_deleted`, and `context.thread_id` to handle Slack sub-threads and WhatsApp deleted message events.
**Reason:** A "unified" schema only works if the adapters are forced to normalize the chaotic, proprietary data weirdness of every trillion-dollar tech company into a single, predictable structure. Without these explicit rule enforcements, the JSON would break during cross-platform AI analysis.

### Decision 9: The Missing Reply ID Problem Abandoned (See Decision 11)
**Date:** April 20, 2026
**Decision:** *This strategy was abandoned. See Decision 11.*

### Decision 11: The "Flat-File" Context Paradox (WhatsApp Replies)
**Date:** April 20, 2026
**Decision:** Overturned Decisions 9 & 10. A secondary Red Team review confirmed that WhatsApp and Line `.txt` consumer exports **do not generate blockquotes or text snippets** to denote replies at all. The reply context is completely stripped by the platform and output as a normal, chronological text message. Therefore, our standard WhatsApp TXT adapter will simply set `reply_to_message_id: null` universally.
**Reason:** Heuristic reverse-string lookups are impossible if the platform strips the quoting metadata entirely from the output text. The only way to retrieve actual context threading for WhatsApp is to build advanced parsing adapters that read their offline SQLite databases (`msgstore.db.crypt14`/`ChatStorage.sqlite`), which actually retain the `reply_to` column data. The pipeline must gracefully accept that simple `.txt` exports mean accepting data loss created by the platform.

### Decision 12: WhatsApp Database Feasibility & "WhatsApp-Chat-Exporter" Integration
**Date:** April 20, 2026
**Decision:** We will support parsing Android `.crypt15` and iOS `ChatStorage.sqlite` databases to recover lost context threading, but we will **not** instruct our tool to extract the encryption keys directly from the phone. Users must extract their own keys using established methods. We will use the schema and logic from the Python tool `KnugiHK/WhatsApp-Chat-Exporter` as a reference, but we will adapt the SQLite querying logic into our TypeScript core rather than distributing the Python tool directly.
**Reason:** 1) Getting the decryption key on Android requires rooting the phone or using sketchy ADB backup downgrades. Apple requires unencrypted local iTunes backups. It is too fragile to automate this cleanly in a universal CLI. 2) Because `WhatsApp-Chat-Exporter` is written in Python, including it directly breaks our "Standalone Executable" zero-dependency requirement for the CLI. Thus, we port just the parsing SQL logic to our TS codebase. 
