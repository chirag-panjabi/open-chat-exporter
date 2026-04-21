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
import { XTwitterDirectMessagesJsAdapter } from '../adapters/x_twitter/XTwitterDirectMessagesJsAdapter';
import { IMessageChatDbAdapter } from '../adapters/imessage/IMessageChatDbAdapter';
import type { AdapterInput } from '../core/BaseAdapter';
import { writeUnifiedExportJson } from '../core/writeUnifiedExportJson';
import { ChatType, Platform } from '../types';

type Args = {
  command?: string;
  input?: string;
  output?: string;
  platform?: string;
  chatName?: string;
  chatType?: string;
  participantCount?: string;
  chatGuid?: string;
  myName?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {};

  const [command, ...rest] = argv;
  if (command && !command.startsWith('-')) args.command = command;

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;

    const [flag, inlineValue] = token.split('=', 2);
    const value = inlineValue ?? rest[i + 1];
    if (inlineValue == null) i++;

    switch (flag) {
      case '--input':
        args.input = value;
        break;
      case '--output':
        args.output = value;
        break;
      case '--platform':
        args.platform = value;
        break;
      case '--chat-name':
        args.chatName = value;
        break;
      case '--chat-type':
        args.chatType = value;
        break;
      case '--participant-count':
        args.participantCount = value;
        break;
      case '--chat-guid':
        args.chatGuid = value;
        break;
      case '--my-name':
        args.myName = value;
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

function usage(): string {
  return [
    'Unified Chat Exporter (WIP)',
    '',
    'Usage:',
    '  bun run src/cli/index.ts convert --input <path> --platform <PLATFORM> [--output <path>]',
    '',
    'Options:',
    '  --input <path>             Path to an export file (or folder for future adapters)',
    '  --platform <PLATFORM>      e.g. WHATSAPP, DISCORD, TELEGRAM, SLACK, IMESSAGE',
    '  --output <path>            Write unified JSON to a file (default: stdout)',
    '  --chat-name <name>         Overrides chat_info.chat_name (default: derived from input filename)',
    '  --chat-type <type>         DIRECT|GROUP|CHANNEL (default: GROUP)',
    '  --participant-count <n>    Optional participant count',
    '  --chat-guid <guid>         (IMESSAGE) chat.guid to export (required)',
    '  --my-name <name>           (IMESSAGE) display name for your outgoing messages (default: Me)',
    '',
    'Note: Not all adapters are implemented yet. Use --platform UNKNOWN to test the pipeline.',
  ].join('\n');
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

  const input: AdapterInput = {
    inputPath: args.input,
    file,
    stream: file.stream(),
  };

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
                          : platform === Platform.WHATSAPP
                            ? new WhatsAppTxtAdapter()
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
    args.chatName ?? (platform === Platform.IMESSAGE ? (args.chatGuid ?? basename(args.input)) : basename(args.input));
  const participantCount = args.participantCount ? Number(args.participantCount) : undefined;

  if (args.participantCount && (Number.isNaN(participantCount) || participantCount! < 0)) {
    process.stderr.write(`Invalid --participant-count: ${args.participantCount}\n`);
    process.exitCode = 2;
    return;
  }

  await writeUnifiedExportJson({
    exportMeta: {
      version: '1.0',
      exporter_version: '0.1.0',
      exported_at: new Date().toISOString(),
    },
    chatInfo: {
      platform,
      chat_name: chatName,
      chat_type: chatType,
      participant_count: participantCount,
    },
    messages: adapter.parseMessages(input),
    outputPath: args.output,
  });
}

main().catch((err) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
