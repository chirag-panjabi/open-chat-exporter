# Unified Chat Exporter Schema Definitions (v1.0-alpha)

To determine the most efficient JSON structure, we examined the native API payloads for Discord, Slack, and the open-source Matrix Protocol.
The problem with native APIs (like Discord's) is that they contain hundreds of irrelevant fields (`embeds`, `author.avatar`, `mentions`, `flags`, `nonce`), creating massive token bloat for LLMs.

Our schema strips away everything except what is required for Contextual AI Inference and Data Analytics.

### 1. Root Export Wrapper Schema
An LLM needs to know *what* it is looking at before it starts processing individual messages. The root object provides the high-level context of the chat room.

```json
{
  "export_meta": {
    "version": "1.0",
    "exporter_version": "0.1.0",
    "exported_at": "2026-04-20T12:00:00Z"
  },
  "chat_info": {
    "platform": "DISCORD",
    "chat_name": "general-engineering",
    "chat_type": "CHANNEL", // Enum: DIRECT, GROUP, CHANNEL
    "participant_count": 1500
  },
  "messages": [
    // Array of Message Objects
  ]
}
```

### 2. The Message Object Schema
This is the core structure. It cleanly separates the sender's identity, the message content, and non-verbal interactions.

**Key Cross-Platform Normalization Rules:**
1. **Missing Native IDs (WhatsApp TXT, LinkedIn, KakaoTalk):** If a platform exports flat text files without unique message IDs, the parser **MUST** generate a deterministic hash (e.g., `SHA-256(timestamp_utc + sender.original_name + content)`) to populate `message_id`. This prevents duplicates during incremental updates.
2. **Proprietary Timestamps (Apple & Meta):** iMessage uses "Apple Mach Absolute Time" (seconds since Jan 1, 2001). Facebook uses UNIX milliseconds. All parsers must mathematically convert these into strict `ISO 8601` UTC strings.
3. **Rich Text Arrays (Telegram):** Telegram exports `text` as an array of strings and objects (e.g., `[{type: "bold", text: "Hello"}]`). The parser must flatten these into standard Markdown (`**Hello**`) for the `content` field.
4. **Implied Sender (iMessage / SMS):** Apple often only exports `is_from_me: 1` instead of your name. The adapter must check a user-provided `--my-name` flag to populate the sender fields correctly.
5. **The Missing Context Problem (WhatsApp TXT, Line TXT):** Flat `.txt` exports from mobile apps like WhatsApp actually **strip all reply and thread metadata completely** upon generation. A quoted reply in the UI is exported simply as a standard, chronological string of text with zero indication that it was a reply. Adapters for these formats must natively set `reply_to_message_id` to `null`. *Note: To retrieve full contextual threading for WhatsApp, users must parse the native encrypted SQLite databases (`msgstore.db.crypt15` on Android or `ChatStorage.sqlite` on iOS backups), which requires extracting decryption keys from rooted/jailbroken devices or unencrypted iTunes backups.*

```json
{
  "message_id": "1123456789012345678", // Discord Native ID or Generated Hash (WhatsApp/LinkedIn)
  "timestamp_utc": "2024-03-15T14:32:01Z", // Strict ISO 8601 (converted from UNIX/Apple Epoch)
  
  "sender": {
    "id": "456789", // Native ID (if available, otherwise hash)
    "original_name": "DaveSmith#8211", // What the platform exported
    "resolved_name": "[User_Dave]" // Populated by the Scrubbing/Identity Resolution stage (not by adapters)
  },
  
  "content": "Does anyone know why the pipeline is failing?", // The raw text body (Markdown flattened)
  
  "context": {
    "reply_to_message_id": "1123456789012345600", // Used to rebuild threads/replies
    "thread_id": "999888777", // If this message belongs to a Slack/Discord/Teams sub-thread
    "forwarded_from": null // String name if natively flagged as a forward (Telegram/WhatsApp)
  },
  
  "interactions": {
    "reactions": [
      {
        "emoji": "👀",
        "count": 2,
        "participants": ["[User_Sarah]", "[User_John]"] // Resolving reaction users is a huge bonus for LLMs
      }
    ]
  },
  
  "metadata": {
    "has_attachment": false, // Media is stripped for V1 to prevent bloat
    "is_edited": false, // Discord, Telegram, Skype
    "is_deleted": false, // Facebook "is_unsent" or WhatsApp "This message was deleted"
    "is_system": false // True if "Dave pinned a message." or group join events
  }
}
```

### 3. The Anonymization Mapping (`identities.yaml`)
To resolve identities across platforms, users can provide a mapping file to the CLI.

```yaml
identities:
  - resolved_name: "[User_Dave]"
    aliases:
      - "DaveSmith#8211" # Discord
      - "+1-555-019-9234" # WhatsApp
      - "david.smith" # Slack

Notes:
- Identity resolution should set `sender.resolved_name` based on the first matching alias.
- Optional anonymization can additionally replace alias occurrences in `content` with `resolved_name` (best-effort; must remain streaming-safe).
```