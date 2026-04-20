/**
 * Represents the high-level metadata of the entire exported chat or room.
 */
export interface IExportMeta {
  /** The version of the Unified Schema used for the export. */
  version: string;
  /** The version of the exporter tool that created this file. */
  exporter_version: string;
  /** ISO 8601 string of when the export was performed. */
  exported_at: string;
}

/**
 * Enumeration of supported chat platforms to ensure consistency.
 */
export enum Platform {
  DISCORD = 'DISCORD',
  WHATSAPP = 'WHATSAPP',
  TELEGRAM = 'TELEGRAM',
  SLACK = 'SLACK',
  IMESSAGE = 'IMESSAGE',
  SIGNAL = 'SIGNAL',
  WECHAT = 'WECHAT',
  LINE = 'LINE',
  KAKAOTALK = 'KAKAOTALK',
  VIBER = 'VIBER',
  FB_MESSENGER = 'FB_MESSENGER',
  INSTAGRAM = 'INSTAGRAM',
  GOOG_CHAT = 'GOOG_CHAT',
  MS_TEAMS = 'MS_TEAMS',
  SNAPCHAT = 'SNAPCHAT',
  X_TWITTER = 'X_TWITTER',
  SKYPE = 'SKYPE',
  LINKEDIN = 'LINKEDIN',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Enumeration of different types of chat contexts.
 */
export enum ChatType {
  DIRECT = 'DIRECT',
  GROUP = 'GROUP',
  CHANNEL = 'CHANNEL',
}

/**
 * Represents the contextual information of the chat room or conversation.
 */
export interface IChatInfo {
  /** The platform from which this chat was exported. */
  platform: Platform | string;
  /** The name of the chat room, group, or direct message context. */
  chat_name: string;
  /** The classification of the chat context. */
  chat_type: ChatType;
  /** Optional count of participants in the chat. */
  participant_count?: number;
}

/**
 * Represents the root wrapper of the unified export format.
 */
export interface IUnifiedExport {
  export_meta: IExportMeta;
  chat_info: IChatInfo;
  messages: IUnifiedMessage[];
}

/**
 * Contains information about the sender of a message.
 */
export interface ISender {
  /** The native string ID from the platform, or a generated hash. */
  id: string;
  /** The original display name or handle exactly as exported by the platform. */
  original_name: string;
  /** The normalized or anonymized name after Identity Resolution runs. */
  resolved_name?: string;
}

/**
 * Represents contextual threading and quoting metadata for a message.
 */
export interface IMessageContext {
  /** The ID of the message this message is directly replying to. Null if none or stripped. */
  reply_to_message_id: string | null;
  /** The ID of the sub-thread this message belongs to (e.g., Slack threads). */
  thread_id?: string | null;
  /** The display name or identifier of the original sender if this message was forwarded. */
  forwarded_from?: string | null;
}

/**
 * Represents an emoji reaction added to a message.
 */
export interface IReaction {
  /** The emoji character or custom emote identifier. */
  emoji: string;
  /** The number of times this specific reaction was applied. */
  count: number;
  /** An array of resolved or original names of participants who added this reaction. */
  participants?: string[];
}

/**
 * Represents non-verbal interactions attached to a message.
 */
export interface IInteractions {
  /** An array of reactions applied to the message. */
  reactions: IReaction[];
}

/**
 * Meta-state flags regarding the message's properties.
 */
export interface IMessageMetadata {
  /** True if the original message contained an attachment (media is stripped in V1). */
  has_attachment: boolean;
  /** True if the message was altered after its original sending time. */
  is_edited: boolean;
  /** True if the message was explicitly deleted (e.g. 'This message was deleted'). */
  is_deleted: boolean;
  /** True if the message is a system notification (e.g. 'User joined the group.'). */
  is_system: boolean;
}

/**
 * Represents a single unified message from any chat platform.
 * NOTE: Normalization Rules must be strictly enforced by the Adapter.
 */
export interface IUnifiedMessage {
  /**
   * The Native ID or a Deterministic Hash (SHA-256).
   * ENFORCEMENT: If platform uses flat text, generate hash using timestamp + sender + content.
   */
  message_id: string;

  /**
   * The timestamp the message was sent.
   * ENFORCEMENT: MUST be converted mathematically to strict ISO 8601 UTC string.
   */
  timestamp_utc: string;

  /** Information regarding the original sender. */
  sender: ISender;

  /**
   * The raw text content.
   * ENFORCEMENT: Any rich text arrays MUST be flattened into standard Markdown strings.
   */
  content: string;

  /** Threading and reply context. */
  context: IMessageContext;

  /** Interactions such as emoji reactions. */
  interactions?: IInteractions;

  /** Flags providing additional context about the message state. */
  metadata: IMessageMetadata;
}
