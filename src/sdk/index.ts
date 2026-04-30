import { Database } from 'bun:sqlite';
import type { BaseAdapter } from '../core/BaseAdapter';
import type { AdapterInput } from '../core/BaseAdapter';
import { Platform } from '../types';

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
import { WhatsAppIosChatStorageDbAdapter } from '../adapters/whatsapp/WhatsAppIosChatStorageDbAdapter';
import { WhatsAppTxtAdapter } from '../adapters/whatsapp/WhatsAppTxtAdapter';
import { XTwitterDirectMessagesJsAdapter } from '../adapters/x_twitter/XTwitterDirectMessagesJsAdapter';
import { IMessageChatDbAdapter } from '../adapters/imessage/IMessageChatDbAdapter';
import {
  loadMetaConversationsApiConfig,
  MetaConversationsApiAdapter,
  type MetaConversationsApiConfig,
} from '../adapters/meta_conversations_api/MetaConversationsApiAdapter';

export type CreateAdapterParams =
  | { platform: Platform.DISCORD }
  | { platform: Platform.FB_MESSENGER }
  | { platform: Platform.GOOG_CHAT }
  | { platform: Platform.INSTAGRAM }
  | { platform: Platform.LINKEDIN }
  | { platform: Platform.MS_TEAMS }
  | { platform: Platform.SLACK }
  | { platform: Platform.TELEGRAM }
  | { platform: Platform.SNAPCHAT }
  | { platform: Platform.X_TWITTER }
  | { platform: Platform.SKYPE }
  | { platform: Platform.UNKNOWN }
  | { platform: Platform.IMESSAGE; chatGuid: string; myName?: string }
  | {
      platform: Platform.WHATSAPP;
      inputPath: string;
      waChatJid?: string;
      waChatPk?: string;
      myName?: string;
    }
  | { platform: Platform.META_CONVERSATIONS_API; config: MetaConversationsApiConfig };

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
  const prefix = await file.slice(0, 16).arrayBuffer();
  const bytes = new Uint8Array(prefix);
  const magic = 'SQLite format 3\u0000';
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic.charCodeAt(i)) return false;
  }
  return true;
}

export function createAdapter(params: CreateAdapterParams): BaseAdapter {
  if (params.platform === Platform.DISCORD) return new DiscordJsonAdapter();
  if (params.platform === Platform.FB_MESSENGER) return new FacebookMessengerJsonAdapter();
  if (params.platform === Platform.GOOG_CHAT) return new GoogleChatJsonAdapter();
  if (params.platform === Platform.INSTAGRAM) return new InstagramJsonAdapter();
  if (params.platform === Platform.LINKEDIN) return new LinkedInMessagesCsvAdapter();
  if (params.platform === Platform.MS_TEAMS) return new MicrosoftTeamsJsonAdapter();
  if (params.platform === Platform.SLACK) return new SlackJsonAdapter();
  if (params.platform === Platform.TELEGRAM) return new TelegramJsonAdapter();
  if (params.platform === Platform.SNAPCHAT) return new SnapchatJsonAdapter();
  if (params.platform === Platform.X_TWITTER) return new XTwitterDirectMessagesJsAdapter();
  if (params.platform === Platform.SKYPE) return new SkypeMessagesJsonAdapter();
  if (params.platform === Platform.UNKNOWN) return new NoopAdapter();

  if (params.platform === Platform.IMESSAGE) {
    return new IMessageChatDbAdapter({ chatGuid: params.chatGuid, myName: params.myName });
  }

  if (params.platform === Platform.META_CONVERSATIONS_API) {
    return new MetaConversationsApiAdapter({ config: params.config });
  }

  if (params.platform === Platform.WHATSAPP) {
    throw new Error(
      'WhatsApp adapter selection may require SQLite sniffing; use createAdapterAsync({ platform: Platform.WHATSAPP, inputPath, ... })'
    );
  }

  // Exhaustive check.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _never: never = params;
  throw new Error(`Unsupported platform: ${(params as { platform: string }).platform}`);
}

export async function createAdapterAsync(params: CreateAdapterParams): Promise<BaseAdapter> {
  if (params.platform !== Platform.WHATSAPP) return createAdapter(params);

  const file = Bun.file(params.inputPath);
  const isSqlite = await sniffSqliteHeader(file);
  if (!isSqlite) {
    return new WhatsAppTxtAdapter();
  }

  const db = new Database(params.inputPath, { readonly: true });
  try {
    const kind = sniffWhatsAppSqliteKind(db);
    if (kind === 'unknown') {
      throw new Error(
        'Unsupported WHATSAPP SQLite schema. Expected iOS ChatStorage.sqlite (ZWAMESSAGE/ZWACHATSESSION) ' +
          'or Android msgstore.db (messages table).'
      );
    }

    if (kind === 'ios') {
      return new WhatsAppIosChatStorageDbAdapter({
        chatJid: params.waChatJid,
        chatPk: params.waChatPk,
        myName: params.myName,
      });
    }

    return new WhatsAppAndroidMsgstoreDbAdapter({
      chatJid: params.waChatJid,
      myName: params.myName,
    });
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

export function openAdapterInput(
  inputPath: string,
  opts?: { lenient?: boolean; onWarning?: AdapterInput['onWarning'] }
): AdapterInput {
  const file = Bun.file(inputPath);
  return {
    inputPath,
    file,
    stream: file.stream(),
    lenient: opts?.lenient,
    onWarning: opts?.onWarning,
  };
}

export async function loadMetaConfigFromJsonFile(inputPath: string): Promise<MetaConversationsApiConfig> {
  return loadMetaConversationsApiConfig(inputPath);
}
