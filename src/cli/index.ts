import { Database } from 'bun:sqlite';
import { mkdir, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { DiscordJsonAdapter } from '../adapters/discord/DiscordJsonAdapter';
import { FacebookMessengerJsonAdapter } from '../adapters/fb_messenger/FacebookMessengerJsonAdapter';
import { GoogleChatJsonAdapter } from '../adapters/goog_chat/GoogleChatJsonAdapter';
import { InstagramJsonAdapter } from '../adapters/instagram/InstagramJsonAdapter';
import { LinkedInMessagesCsvAdapter } from '../adapters/linkedin/LinkedInMessagesCsvAdapter';
import { MicrosoftTeamsJsonAdapter } from '../adapters/ms_teams/MicrosoftTeamsJsonAdapter';
import { NoopAdapter } from '../adapters/noop/NoopAdapter';
import { SkypeMessagesJsonAdapter } from '../adapters/skype/SkypeMessagesJsonAdapter';
import { SnapchatJsonAdapter } from '../adapters/snapchat/SnapchatJsonAdapter';
import { SlackJsonAdapter } from '../adapters/slack/SlackJsonAdapter';
import { TelegramJsonAdapter } from '../adapters/telegram/TelegramJsonAdapter';
import { WhatsAppAndroidMsgstoreDbAdapter } from '../adapters/whatsapp/WhatsAppAndroidMsgstoreDbAdapter';
import { WhatsAppTxtAdapter } from '../adapters/whatsapp/WhatsAppTxtAdapter';
import { WhatsAppIosChatStorageDbAdapter } from '../adapters/whatsapp/WhatsAppIosChatStorageDbAdapter';
import { XTwitterDirectMessagesJsAdapter } from '../adapters/x_twitter/XTwitterDirectMessagesJsAdapter';
import { IMessageChatDbAdapter } from '../adapters/imessage/IMessageChatDbAdapter';
import {
  loadMetaConversationsApiConfig,
  MetaConversationsApiAdapter,
  type MetaConversationsApiConfig,
} from '../adapters/meta_conversations_api/MetaConversationsApiAdapter';
import type { AdapterInput } from '../core/BaseAdapter';
import {
  normalizeIdentitiesFile,
  scrubMessages,
  type IdentitiesFile,
  type ScrubOptions,
} from '../core/scrubMessages';
import { writeUnifiedExportCsv } from '../core/writeUnifiedExportCsv';
import { writeUnifiedExportJson } from '../core/writeUnifiedExportJson';
import { writeUnifiedExportJsonChunked } from '../core/writeUnifiedExportJsonChunked';
import { writeUnifiedMessagesJsonArray } from '../core/writeUnifiedMessagesJsonArray';
import { writeUnifiedMessagesJsonArrayChunked } from '../core/writeUnifiedMessagesJsonArrayChunked';
import { writeUnifiedMessagesMinimalJsonArray } from '../core/writeUnifiedMessagesMinimalJsonArray';
import { writeUnifiedMessagesMinimalJsonArrayChunked } from '../core/writeUnifiedMessagesMinimalJsonArrayChunked';
import { writeUnifiedExportMarkdown } from '../core/writeUnifiedExportMarkdown';
import { writeUnifiedExportMarkdownChunked } from '../core/writeUnifiedExportMarkdownChunked';
import type { ChunkBy } from '../core/chunking';
import { createDedupFilter, formatDedupStats, type DedupStats } from '../core/dedupAgainst';
import type { IUnifiedMessage } from '../types';
import { ChatType, Platform } from '../types';
import YAML from 'yaml';

type OutputFormat = 'json' | 'md' | 'csv';
type OutputProfile = 'canonical' | 'messages-array' | 'minimal';
type LogFormat = 'text' | 'jsonl';

type Args = {
  command?: string;
  input?: string;
  output?: string;
  outputFormat?: string;
  outputProfile?: string;
  reportJson?: string;
  quiet?: boolean;
  lenient?: boolean;
  logFormat?: string;
  chunkBy?: string;
  overwrite?: boolean;
  dedupAgainst?: string;
  platform?: string;
  chatName?: string;
  chatType?: string;
  participantCount?: string;
  chatGuid?: string;
  myName?: string;
  waChatJid?: string;
  waChatPk?: string;
  identities?: string;
  anonymize?: boolean;
  sinceUtc?: string;
  untilUtc?: string;
  dropSystem?: boolean;
  minContentLength?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {};

  const [command, ...rest] = argv;
  if (command && !command.startsWith('-')) args.command = command;

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;

    const [flag, inlineValue] = token.split('=', 2);
    let value: string | undefined = inlineValue;
    let consumedNext = false;
    if (inlineValue == null) {
      const next = rest[i + 1];
      if (next != null && !next.startsWith('--')) {
        value = next;
        consumedNext = true;
      }
    }

    switch (flag) {
      case '--input':
        args.input = value;
        if (consumedNext) i++;
        break;
      case '--output':
        args.output = value;
        if (consumedNext) i++;
        break;
      case '--output-format':
        args.outputFormat = value;
        if (consumedNext) i++;
        break;
      case '--output-profile':
        args.outputProfile = value;
        if (consumedNext) i++;
        break;
      case '--dedup-against':
        args.dedupAgainst = value;
        if (consumedNext) i++;
        break;
      case '--chunk-by':
        args.chunkBy = value;
        if (consumedNext) i++;
        break;
      case '--report-json':
        args.reportJson = value;
        if (consumedNext) i++;
        break;
      case '--quiet':
        args.quiet = value == null ? true : value.trim().toLowerCase() !== 'false';
        if (consumedNext) i++;
        break;
      case '--lenient':
        args.lenient = value == null ? true : value.trim().toLowerCase() !== 'false';
        if (consumedNext) i++;
        break;
      case '--log-format':
        args.logFormat = value;
        if (consumedNext) i++;
        break;
      case '--platform':
        args.platform = value;
        if (consumedNext) i++;
        break;
      case '--chat-name':
        args.chatName = value;
        if (consumedNext) i++;
        break;
      case '--chat-type':
        args.chatType = value;
        if (consumedNext) i++;
        break;
      case '--participant-count':
        args.participantCount = value;
        if (consumedNext) i++;
        break;
      case '--chat-guid':
        args.chatGuid = value;
        if (consumedNext) i++;
        break;
      case '--my-name':
        args.myName = value;
        if (consumedNext) i++;
        break;
      case '--wa-chat-jid':
        args.waChatJid = value;
        if (consumedNext) i++;
        break;
      case '--wa-chat-pk':
        args.waChatPk = value;
        if (consumedNext) i++;
        break;
      case '--identities':
        args.identities = value;
        if (consumedNext) i++;
        break;
      case '--anonymize':
        args.anonymize = value == null ? true : value.trim().toLowerCase() !== 'false';
        if (consumedNext) i++;
        break;
      case '--overwrite':
        args.overwrite = value == null ? true : value.trim().toLowerCase() !== 'false';
        if (consumedNext) i++;
        break;
      case '--since-utc':
        args.sinceUtc = value;
        if (consumedNext) i++;
        break;
      case '--until-utc':
        args.untilUtc = value;
        if (consumedNext) i++;
        break;
      case '--drop-system':
        args.dropSystem = value == null ? true : value.trim().toLowerCase() !== 'false';
        if (consumedNext) i++;
        break;
      case '--min-content-length':
        args.minContentLength = value;
        if (consumedNext) i++;
        break;
      default:
        break;
    }
  }

  return args;
}

function normalizePlatform(platform?: string): Platform {
  if (!platform) return Platform.UNKNOWN;
  const key = platform.trim().toUpperCase();
  return (Platform as Record<string, Platform>)[key] ?? Platform.UNKNOWN;
}

function normalizeChatType(chatType?: string): ChatType {
  if (!chatType) return ChatType.GROUP;
  const key = chatType.trim().toUpperCase();
  return (ChatType as Record<string, ChatType>)[key] ?? ChatType.GROUP;
}

function normalizeOutputFormat(raw?: string): OutputFormat {
  if (!raw) return 'json';
  const key = raw.trim().toLowerCase();
  if (key === 'json' || key === 'md' || key === 'csv') return key;
  return 'json';
}

function normalizeOutputProfile(raw?: string): OutputProfile {
  if (!raw) return 'canonical';
  const key = raw.trim().toLowerCase();
  if (key === 'canonical') return 'canonical';
  if (key === 'messages-array' || key === 'messages_array' || key === 'messages') return 'messages-array';
  if (key === 'minimal' || key === 'minimal-v1' || key === 'sovereign-minimal') return 'minimal';
  return 'canonical';
}

function normalizeChunkBy(raw?: string): 'none' | ChunkBy {
  if (!raw) return 'none';
  const key = raw.trim().toLowerCase();
  if (key === 'none') return 'none';
  if (key === 'day' || key === 'month') return key;
  return 'none';
}

function normalizeLogFormat(raw?: string): LogFormat {
  if (!raw) return 'text';
  const key = raw.trim().toLowerCase();
  if (key === 'jsonl' || key === 'json-lines' || key === 'jsonlines') return 'jsonl';
  return 'text';
}

type LogEventNoTs = {
  type: 'warning' | 'progress' | 'fatal' | 'info' | 'dedup' | 'start' | 'finish';
  code?: string;
  message?: string;
} & Record<string, unknown>;

type LogEvent = LogEventNoTs & { ts: string };

function createStderrLogger(params: { format: LogFormat; quiet: boolean }) {
  const writeLine = (line: string) => {
    process.stderr.write(line.endsWith('\n') ? line : `${line}\n`);
  };

  const emit = (event: LogEventNoTs) => {
    const full: LogEvent = { ...event, ts: new Date().toISOString() };
    if (params.format === 'jsonl') {
      writeLine(JSON.stringify(full));
      return;
    }

    // text fallback (human-readable)
    if (full.type === 'warning') {
      writeLine(`WARN ${String(full.code ?? 'UNKNOWN')}: ${String(full.message ?? '')}`.trimEnd());
      return;
    }
    if (full.type === 'fatal') {
      if (typeof full.stack === 'string' && full.stack.trim() !== '') {
        writeLine(full.stack);
      } else {
        writeLine(String(full.message ?? 'Fatal error'));
      }
      if (typeof full.usage === 'string' && full.usage.trim() !== '') writeLine(`\n${full.usage}`);
      return;
    }
    if (full.type === 'dedup') {
      if (typeof full.text === 'string' && full.text.trim() !== '') writeLine(String(full.text));
      return;
    }
    if (full.type === 'info') {
      if (typeof full.message === 'string' && full.message.trim() !== '') writeLine(String(full.message));
      return;
    }

    // For other event types in text mode, avoid noisy output.
  };

  return {
    event: (e: LogEventNoTs) => {
      const isFatal = e.type === 'fatal';
      if (params.quiet && !isFatal) return;
      emit(e);
    },
    warn: (code: string, message: string, extra?: Record<string, unknown>) => {
      if (params.quiet) return;
      emit({ type: 'warning', code, message, ...(extra ?? {}) });
    },
    info: (message: string, extra?: Record<string, unknown>) => {
      if (params.quiet) return;
      emit({ type: 'info', message, ...(extra ?? {}) });
    },
    fatal: (message: string, extra?: Record<string, unknown>) => {
      emit({ type: 'fatal', message, ...(extra ?? {}) });
    },
    progress: (extra: Record<string, unknown>) => {
      if (params.quiet) return;
      emit({ type: 'progress', ...extra });
    },
    start: (extra: Record<string, unknown>) => {
      if (params.quiet) return;
      emit({ type: 'start', ...extra });
    },
    finish: (extra: Record<string, unknown>) => {
      if (params.quiet) return;
      emit({ type: 'finish', ...extra });
    },
    dedup: (extra: Record<string, unknown>) => {
      if (params.quiet) return;
      emit({ type: 'dedup', ...extra });
    },
  };
}

async function ensureDir(path: string): Promise<void> {
  try {
    const s = await stat(path);
    if (!s.isDirectory()) throw new Error(`Output path exists and is not a directory: ${path}`);
  } catch (err) {
    const code = getNodeErrorCode(err);
    if (code === 'ENOENT') {
      await mkdir(path, { recursive: true });
      return;
    }
    throw err;
  }
}

function getNodeErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  if (!('code' in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

async function loadIdentitiesYaml(filePath: string): Promise<IdentitiesFile> {
  const file = Bun.file(filePath);
  const exists = await file.exists();
  if (!exists) throw new Error(`identities.yaml not found: ${filePath}`);
  const text = await file.text();
  const raw = YAML.parse(text) as unknown;
  return normalizeIdentitiesFile(raw);
}

function usage(): string {
  return [
    'Unified Chat Exporter (WIP)',
    '',
    'Usage:',
    '  <executable> convert --input <path> --platform <PLATFORM> [--output <path>]',
    '  bun run src/cli/index.ts convert --input <path> --platform <PLATFORM> [--output <path>]',
    '',
    'Where <executable> is the standalone binary path (e.g., ./dist/unified-chat-exporter-macos-arm64)',
    '',
    'Options:',
    '  --input <path>             Path to an export file (or folder for future adapters)',
    '  --platform <PLATFORM>      e.g. WHATSAPP, DISCORD, TELEGRAM, SLACK, IMESSAGE, META_CONVERSATIONS_API',
    '  --output <path>            Write output to a file (default: stdout)',
    '  --output-format <fmt>      json|md|csv (default: json)',
    '  --output-profile <profile> canonical|messages-array|minimal (default: canonical; JSON only)',
    '  --dedup-against <path>     Drop messages whose message_id exists in a prior unified JSON export (file or directory of *.json)',
    '  --chunk-by <mode>          none|day|month (default: none; requires --output as a directory)',
    '  --overwrite                Allow replacing existing output files (chunking mode)',
    '  --report-json <path>       Write a small JSON run report (messages emitted, dedup stats, timings)',
    '  --quiet                    Suppress non-error stderr output (e.g., dedup summary)',
    '  --lenient                  Best-effort parsing: warn/skip when feasible instead of crashing',
    '  --log-format <fmt>         text|jsonl (default: text; formats stderr events only)',
    '  --chat-name <name>         Overrides chat_info.chat_name (default: derived from input filename)',
    '  --chat-type <type>         DIRECT|GROUP|CHANNEL (default: GROUP)',
    '  --participant-count <n>    Optional participant count',
    '  --identities <path>        Path to identities.yaml (for sender.resolved_name)',
    '  --anonymize                Replace alias occurrences in content with resolved_name',
    '  --since-utc <iso>          Drop messages older than this ISO timestamp (UTC)',
    '  --until-utc <iso>          Drop messages newer than this ISO timestamp (UTC)',
    '  --drop-system              Drop messages where metadata.is_system is true',
    '  --min-content-length <n>   Drop messages with trimmed content shorter than n',
    '  --chat-guid <guid>         (IMESSAGE) chat.guid to export (required)',
    '  --my-name <name>           (IMESSAGE) display name for your outgoing messages (default: Me)',
    '  --wa-chat-jid <jid>        (WHATSAPP SQLite) select chat by JID (iOS ChatStorage.sqlite or Android msgstore.db)',
    '  --wa-chat-pk <pk>          (WHATSAPP iOS ChatStorage.sqlite) select chat by ZWACHATSESSION.Z_PK',
    '',
    'Meta Conversations API notes:',
    '  - Requires META_ACCESS_TOKEN (except when using META_API_FIXTURE_DIR for tests)',
    '  - --input should point to a small JSON config (non-secret identifiers + selection params)',
    '',
    'Note: Not all adapters are implemented yet. Use --platform UNKNOWN to test the pipeline.',
  ].join('\n');
}

function hasSqliteTable(db: Database, table: string): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?1 LIMIT 1")
    .get(table) as { name?: string } | null;
  return Boolean(row?.name);
}

function sniffWhatsAppSqliteKind(db: Database): 'ios' | 'android' | 'unknown' {
  if (hasSqliteTable(db, 'ZWAMESSAGE') && hasSqliteTable(db, 'ZWACHATSESSION')) return 'ios';
  if (hasSqliteTable(db, 'messages')) return 'android';
  return 'unknown';
}

async function sniffSqliteHeader(file: ReturnType<typeof Bun.file>): Promise<boolean> {
  // Read a tiny prefix only; safe for huge files.
  const prefix = await file.slice(0, 16).arrayBuffer();
  const bytes = new Uint8Array(prefix);
  const magic = 'SQLite format 3\u0000';
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic.charCodeAt(i)) return false;
  }
  return true;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const logFormat = normalizeLogFormat(args.logFormat);
  const log = createStderrLogger({ format: logFormat, quiet: Boolean(args.quiet) });

  if (!args.command || args.command === '--help' || args.command === '-h') {
    process.stdout.write(`${usage()}\n`);
    process.exitCode = 0;
    return;
  }

  if (args.command !== 'convert') {
    log.fatal(`Unknown command: ${args.command}`, { code: 'UNKNOWN_COMMAND', usage: usage() });
    process.exitCode = 2;
    return;
  }

  if (!args.input) {
    log.fatal('Missing required flag: --input', { code: 'MISSING_INPUT', usage: usage() });
    process.exitCode = 2;
    return;
  }

  if (!args.platform) {
    log.fatal('Missing required flag: --platform', { code: 'MISSING_PLATFORM', usage: usage() });
    process.exitCode = 2;
    return;
  }

  const platform = normalizePlatform(args.platform);
  const chatType = normalizeChatType(args.chatType);
  const outputFormat = normalizeOutputFormat(args.outputFormat);
  const outputProfile = normalizeOutputProfile(args.outputProfile);
  const chunkBy = normalizeChunkBy(args.chunkBy);

  if (outputProfile !== 'canonical' && outputFormat !== 'json') {
    log.fatal(`--output-profile ${outputProfile} is only supported for --output-format json`, {
      code: 'INVALID_OUTPUT_PROFILE',
    });
    process.exitCode = 2;
    return;
  }

  let metaApiConfig: MetaConversationsApiConfig | undefined;

  if (platform === Platform.IMESSAGE && !args.chatGuid) {
    log.fatal('Missing required flag for IMESSAGE: --chat-guid', { code: 'MISSING_CHAT_GUID', usage: usage() });
    process.exitCode = 2;
    return;
  }

  const file = Bun.file(args.input);
  const exists = await file.exists();
  if (!exists) {
    log.fatal('Input path does not exist', { code: 'INPUT_NOT_FOUND' });
    process.exitCode = 2;
    return;
  }

  if (platform === Platform.META_CONVERSATIONS_API) {
    metaApiConfig = await loadMetaConversationsApiConfig(args.input);
  }

  const input: AdapterInput = {
    inputPath: args.input,
    file,
    stream: file.stream(),
  };

  let warningsCount = 0;
  const warningCountsByCode: Record<string, number> = {};
  input.lenient = Boolean(args.lenient);
  input.onWarning = (warning) => {
    warningsCount++;
    warningCountsByCode[warning.code] = (warningCountsByCode[warning.code] ?? 0) + 1;
    log.warn(warning.code, warning.message, { platform: String(platform) });
  };

  const isWhatsAppSqlite = platform === Platform.WHATSAPP ? await sniffSqliteHeader(file) : false;

  let whatsAppSqliteKind: 'ios' | 'android' | 'unknown' = 'unknown';
  if (platform === Platform.WHATSAPP && isWhatsAppSqlite) {
    const db = new Database(args.input, { readonly: true });
    try {
      whatsAppSqliteKind = sniffWhatsAppSqliteKind(db);
    } finally {
      try {
        db.close();
      } catch {
        // ignore
      }
    }

    if (whatsAppSqliteKind === 'unknown') {
      log.fatal(
        'Unsupported WHATSAPP SQLite schema. Expected iOS ChatStorage.sqlite (ZWAMESSAGE/ZWACHATSESSION) or Android msgstore.db (messages table).',
        { code: 'UNSUPPORTED_WHATSAPP_SQLITE_SCHEMA' }
      );
      process.exitCode = 3;
      return;
    }
  }

  const adapter =
    platform === Platform.DISCORD
      ? new DiscordJsonAdapter()
      : platform === Platform.FB_MESSENGER
        ? new FacebookMessengerJsonAdapter()
        : platform === Platform.GOOG_CHAT
          ? new GoogleChatJsonAdapter()
          : platform === Platform.MS_TEAMS
            ? new MicrosoftTeamsJsonAdapter()
            : platform === Platform.X_TWITTER
              ? new XTwitterDirectMessagesJsAdapter()
              : platform === Platform.SKYPE
                ? new SkypeMessagesJsonAdapter()
                : platform === Platform.INSTAGRAM
                  ? new InstagramJsonAdapter()
                  : platform === Platform.SNAPCHAT
                    ? new SnapchatJsonAdapter()
                    : platform === Platform.LINKEDIN
                      ? new LinkedInMessagesCsvAdapter()
                      : platform === Platform.TELEGRAM
                        ? new TelegramJsonAdapter()
                        : platform === Platform.SLACK
                          ? new SlackJsonAdapter()
                          : platform === Platform.IMESSAGE
                            ? new IMessageChatDbAdapter({ chatGuid: args.chatGuid!, myName: args.myName })
                            : platform === Platform.META_CONVERSATIONS_API
                              ? new MetaConversationsApiAdapter({ config: metaApiConfig! })
                              : platform === Platform.WHATSAPP
                                ? isWhatsAppSqlite
                                  ? whatsAppSqliteKind === 'ios'
                                    ? new WhatsAppIosChatStorageDbAdapter({
                                      chatJid: args.waChatJid,
                                      chatPk: args.waChatPk,
                                      myName: args.myName,
                                    })
                                    : new WhatsAppAndroidMsgstoreDbAdapter({
                                      chatJid: args.waChatJid,
                                      myName: args.myName,
                                    })
                                  : new WhatsAppTxtAdapter()
                                : platform === Platform.UNKNOWN
                                  ? new NoopAdapter()
                                  : null;
  if (!adapter) {
    log.fatal(`Adapter not implemented for platform: ${platform}`, {
      code: 'ADAPTER_NOT_IMPLEMENTED',
      note: 'Run with --platform UNKNOWN to test streaming output.',
    });
    process.exitCode = 3;
    return;
  }

  const chatName =
    args.chatName ??
    metaApiConfig?.chat_name ??
    (platform === Platform.IMESSAGE ? (args.chatGuid ?? basename(args.input)) : basename(args.input));
  const participantCount = args.participantCount ? Number(args.participantCount) : undefined;

  if (args.participantCount && (Number.isNaN(participantCount) || participantCount! < 0)) {
    log.fatal('Invalid --participant-count', { code: 'INVALID_PARTICIPANT_COUNT' });
    process.exitCode = 2;
    return;
  }

  const minContentLength = args.minContentLength ? Number(args.minContentLength) : undefined;
  if (args.minContentLength && (Number.isNaN(minContentLength) || minContentLength! < 0)) {
    log.fatal('Invalid --min-content-length', { code: 'INVALID_MIN_CONTENT_LENGTH' });
    process.exitCode = 2;
    return;
  }

  const identities = args.identities ? await loadIdentitiesYaml(args.identities) : undefined;
  const scrubOpts: ScrubOptions = {
    identities,
    anonymize: args.anonymize,
    sinceUtc: args.sinceUtc,
    untilUtc: args.untilUtc,
    dropSystem: args.dropSystem,
    minContentLength,
  };

  let messages: AsyncIterable<IUnifiedMessage> = adapter.parseMessages(input);

  let dedupStats: DedupStats | undefined;
  let closeDedup: (() => void) | undefined;

  if (args.dedupAgainst) {
    const dedup = await createDedupFilter({ dedupAgainstPath: args.dedupAgainst });
    dedupStats = dedup.stats;
    closeDedup = dedup.close;
    messages = dedup.filter(messages);
  }

  if (
    scrubOpts.identities ||
    scrubOpts.anonymize ||
    scrubOpts.sinceUtc ||
    scrubOpts.untilUtc ||
    scrubOpts.dropSystem ||
    scrubOpts.minContentLength != null
  ) {
    messages = scrubMessages(messages, scrubOpts);
  }

  const exportMeta = {
    version: '1.0',
    exporter_version: '0.1.0',
    exported_at: new Date().toISOString(),
  };

  const chatInfo = {
    platform: platform === Platform.META_CONVERSATIONS_API ? metaApiConfig!.surface : platform,
    chat_name: chatName,
    chat_type: chatType,
    participant_count: participantCount,
  };

  const startedAt = Date.now();
  let messagesEmitted = 0;
  log.start({
    platform: String(platform),
    output_format: outputFormat,
    output_profile: outputProfile,
    chunk_by: chunkBy,
    lenient: Boolean(args.lenient),
    dedup_enabled: Boolean(args.dedupAgainst),
    log_format: logFormat,
  });

  let lastProgressAt = startedAt;
  let lastProgressCount = 0;
  const countedMessages: AsyncIterable<IUnifiedMessage> = (async function* () {
    for await (const m of messages) {
      messagesEmitted++;

      // Sovereign IPC: emit periodic progress events in JSONL mode.
      if (logFormat === 'jsonl' && !args.quiet) {
        const now = Date.now();
        const timeDue = now - lastProgressAt >= 1000;
        const countDue = messagesEmitted - lastProgressCount >= 1000;
        if (messagesEmitted === 1 || timeDue || countDue) {
          log.progress({ platform: String(platform), messages_emitted: messagesEmitted });
          lastProgressAt = now;
          lastProgressCount = messagesEmitted;
        }
      }

      yield m;
    }
  })();

  let success = false;
  let errorMessage: string | undefined;

  try {
    if (chunkBy !== 'none') {
      if (!args.output || args.output.trim() === '' || args.output === '-') {
        log.fatal('Chunking mode requires --output <dir> (stdout is not supported)', {
          code: 'CHUNKING_REQUIRES_OUTPUT_DIR',
          usage: usage(),
        });
        process.exitCode = 2;
        return;
      }
      if (outputFormat === 'csv') {
        log.fatal('Chunking is not supported for --output-format csv', { code: 'CHUNKING_UNSUPPORTED_FOR_CSV' });
        process.exitCode = 2;
        return;
      }

      await ensureDir(args.output);

      if (outputFormat === 'md') {
        await writeUnifiedExportMarkdownChunked({
          exportMeta,
          chatInfo,
          messages: countedMessages,
          outputDir: args.output,
          chunkBy,
          overwrite: args.overwrite,
        });
      } else {
        if (outputProfile === 'canonical') {
          await writeUnifiedExportJsonChunked({
            exportMeta,
            chatInfo,
            messages: countedMessages,
            outputDir: args.output,
            chunkBy,
            overwrite: args.overwrite,
          });
        } else if (outputProfile === 'messages-array') {
          await writeUnifiedMessagesJsonArrayChunked({
            chatInfo,
            messages: countedMessages,
            outputDir: args.output,
            chunkBy,
            overwrite: args.overwrite,
          });
        } else {
          await writeUnifiedMessagesMinimalJsonArrayChunked({
            chatInfo,
            messages: countedMessages,
            outputDir: args.output,
            chunkBy,
            overwrite: args.overwrite,
          });
        }
      }
      success = true;
      return;
    }

    if (outputFormat === 'md') {
      await writeUnifiedExportMarkdown({
        exportMeta,
        chatInfo,
        messages: countedMessages,
        outputPath: args.output,
      });
    } else if (outputFormat === 'csv') {
      await writeUnifiedExportCsv({ exportMeta, chatInfo, messages: countedMessages, outputPath: args.output });
    } else {
      if (outputProfile === 'canonical') {
        await writeUnifiedExportJson({ exportMeta, chatInfo, messages: countedMessages, outputPath: args.output });
      } else if (outputProfile === 'messages-array') {
        await writeUnifiedMessagesJsonArray({ messages: countedMessages, outputPath: args.output });
      } else {
        await writeUnifiedMessagesMinimalJsonArray({
          platform: String(chatInfo.platform),
          messages: countedMessages,
          outputPath: args.output,
        });
      }
    }

    success = true;
  } catch (err) {
    errorMessage = err instanceof Error ? (err.stack ?? err.message) : String(err);
    throw err;
  } finally {
    const finishedAt = Date.now();
    log.finish({
      platform: String(platform),
      success,
      duration_ms: finishedAt - startedAt,
      messages_emitted: messagesEmitted,
      warnings_count: warningsCount,
    });

    const report = {
      success,
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date(finishedAt).toISOString(),
      duration_ms: finishedAt - startedAt,
      platform: String(platform),
      input: args.input,
      output: args.output,
      output_format: outputFormat,
      output_profile: outputProfile,
      chunk_by: chunkBy,
      overwrite: Boolean(args.overwrite),
      lenient: Boolean(args.lenient),
      messages_emitted: messagesEmitted,
      warnings: {
        count: warningsCount,
        by_code: warningCountsByCode,
      },
      dedup: dedupStats ? dedupStats : undefined,
      error: errorMessage,
    };

    if (closeDedup) closeDedup();
    if (dedupStats) {
      if (logFormat === 'jsonl') {
        log.dedup({ platform: String(platform), ...dedupStats });
      } else if (!args.quiet) {
        log.dedup({ text: `${formatDedupStats(dedupStats)}\n` });
      }
    }

    if (args.reportJson && args.reportJson.trim() !== '') {
      try {
        await Bun.write(args.reportJson, JSON.stringify(report, null, 2) + '\n');
      } catch {
        // ignore report-writing errors (do not mask primary errors)
      }
    }
  }
}

main().catch((err) => {
  const args = parseArgs(process.argv.slice(2));
  const logFormat = normalizeLogFormat(args.logFormat);
  const log = createStderrLogger({ format: logFormat, quiet: Boolean(args.quiet) });
  const message = err instanceof Error ? (err.message || 'Fatal error') : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  log.fatal(message, { code: 'UNCAUGHT_ERROR', stack });
  process.exitCode = 1;
});
