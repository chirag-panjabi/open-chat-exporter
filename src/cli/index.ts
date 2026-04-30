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
import { writeUnifiedExportMarkdown } from '../core/writeUnifiedExportMarkdown';
import { writeUnifiedExportMarkdownChunked } from '../core/writeUnifiedExportMarkdownChunked';
import type { ChunkBy } from '../core/chunking';
import { createDedupFilter, formatDedupStats, type DedupStats } from '../core/dedupAgainst';
import type { IUnifiedMessage } from '../types';
import { ChatType, Platform } from '../types';
import YAML from 'yaml';

type OutputFormat = 'json' | 'md' | 'csv';

type Args = {
  command?: string;
  input?: string;
  output?: string;
  outputFormat?: string;
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
      case '--dedup-against':
        args.dedupAgainst = value;
        if (consumedNext) i++;
        break;
      case '--chunk-by':
        args.chunkBy = value;
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

function normalizeChunkBy(raw?: string): 'none' | ChunkBy {
  if (!raw) return 'none';
  const key = raw.trim().toLowerCase();
  if (key === 'none') return 'none';
  if (key === 'day' || key === 'month') return key;
  return 'none';
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
    '  bun run src/cli/index.ts convert --input <path> --platform <PLATFORM> [--output <path>]',
    '',
    'Options:',
    '  --input <path>             Path to an export file (or folder for future adapters)',
    '  --platform <PLATFORM>      e.g. WHATSAPP, DISCORD, TELEGRAM, SLACK, IMESSAGE, META_CONVERSATIONS_API',
    '  --output <path>            Write output to a file (default: stdout)',
    '  --output-format <fmt>      json|md|csv (default: json)',
    '  --dedup-against <path>     Drop messages whose message_id exists in a prior unified JSON export (file or directory of *.json)',
    '  --chunk-by <mode>          none|day|month (default: none; requires --output as a directory)',
    '  --overwrite                Allow replacing existing output files (chunking mode)',
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
    '  --wa-chat-jid <jid>        (WHATSAPP ChatStorage.sqlite) select chat by ZWACHATSESSION.ZCONTACTJID',
    '  --wa-chat-pk <pk>          (WHATSAPP ChatStorage.sqlite) select chat by ZWACHATSESSION.Z_PK',
    '',
    'Meta Conversations API notes:',
    '  - Requires META_ACCESS_TOKEN (except when using META_API_FIXTURE_DIR for tests)',
    '  - --input should point to a small JSON config (non-secret identifiers + selection params)',
    '',
    'Note: Not all adapters are implemented yet. Use --platform UNKNOWN to test the pipeline.',
  ].join('\n');
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

  if (!args.command || args.command === '--help' || args.command === '-h') {
    process.stdout.write(`${usage()}\n`);
    process.exitCode = 0;
    return;
  }

  if (args.command !== 'convert') {
    process.stderr.write(`Unknown command: ${args.command}\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  if (!args.input) {
    process.stderr.write(`Missing required flag: --input\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  if (!args.platform) {
    process.stderr.write(`Missing required flag: --platform\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  const platform = normalizePlatform(args.platform);
  const chatType = normalizeChatType(args.chatType);
  const outputFormat = normalizeOutputFormat(args.outputFormat);
  const chunkBy = normalizeChunkBy(args.chunkBy);

  let metaApiConfig: MetaConversationsApiConfig | undefined;

  if (platform === Platform.IMESSAGE && !args.chatGuid) {
    process.stderr.write(`Missing required flag for IMESSAGE: --chat-guid\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  const file = Bun.file(args.input);
  const exists = await file.exists();
  if (!exists) {
    process.stderr.write(`Input path does not exist: ${args.input}\n`);
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

  const isWhatsAppSqlite = platform === Platform.WHATSAPP ? await sniffSqliteHeader(file) : false;

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
                                  ? new WhatsAppIosChatStorageDbAdapter({
                                    chatJid: args.waChatJid,
                                    chatPk: args.waChatPk,
                                    myName: args.myName,
                                  })
                                  : new WhatsAppTxtAdapter()
                                : platform === Platform.UNKNOWN
                                  ? new NoopAdapter()
                                  : null;
  if (!adapter) {
    process.stderr.write(
      `Adapter not implemented for platform: ${platform}\n` +
      `For now, run with --platform UNKNOWN to test streaming output.\n`
    );
    process.exitCode = 3;
    return;
  }

  const chatName =
    args.chatName ??
    metaApiConfig?.chat_name ??
    (platform === Platform.IMESSAGE ? (args.chatGuid ?? basename(args.input)) : basename(args.input));
  const participantCount = args.participantCount ? Number(args.participantCount) : undefined;

  if (args.participantCount && (Number.isNaN(participantCount) || participantCount! < 0)) {
    process.stderr.write(`Invalid --participant-count: ${args.participantCount}\n`);
    process.exitCode = 2;
    return;
  }

  const minContentLength = args.minContentLength ? Number(args.minContentLength) : undefined;
  if (args.minContentLength && (Number.isNaN(minContentLength) || minContentLength! < 0)) {
    process.stderr.write(`Invalid --min-content-length: ${args.minContentLength}\n`);
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

  try {
    if (chunkBy !== 'none') {
      if (!args.output || args.output.trim() === '' || args.output === '-') {
        process.stderr.write(`Chunking mode requires --output <dir> (stdout is not supported)\n\n${usage()}\n`);
        process.exitCode = 2;
        return;
      }
      if (outputFormat === 'csv') {
        process.stderr.write(`Chunking is not supported for --output-format csv\n`);
        process.exitCode = 2;
        return;
      }

      await ensureDir(args.output);

      if (outputFormat === 'md') {
        await writeUnifiedExportMarkdownChunked({
          exportMeta,
          chatInfo,
          messages,
          outputDir: args.output,
          chunkBy,
          overwrite: args.overwrite,
        });
      } else {
        await writeUnifiedExportJsonChunked({
          exportMeta,
          chatInfo,
          messages,
          outputDir: args.output,
          chunkBy,
          overwrite: args.overwrite,
        });
      }
      return;
    }

    if (outputFormat === 'md') {
      await writeUnifiedExportMarkdown({ exportMeta, chatInfo, messages, outputPath: args.output });
    } else if (outputFormat === 'csv') {
      await writeUnifiedExportCsv({ exportMeta, chatInfo, messages, outputPath: args.output });
    } else {
      await writeUnifiedExportJson({ exportMeta, chatInfo, messages, outputPath: args.output });
    }
  } finally {
    if (closeDedup) closeDedup();
    if (dedupStats) process.stderr.write(`${formatDedupStats(dedupStats)}\n`);
  }
}

main().catch((err) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
