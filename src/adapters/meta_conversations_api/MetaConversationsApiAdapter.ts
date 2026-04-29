import type { IUnifiedMessage } from '../../types';
import { Platform } from '../../types';
import type { AdapterInput } from '../../core/BaseAdapter';
import { BaseAdapter } from '../../core/BaseAdapter';

type MetaConversationApiSurface = 'FB_MESSENGER' | 'INSTAGRAM';

export type MetaConversationsApiConfig = {
    surface: MetaConversationApiSurface;
    conversation_id: string;
    account_id?: string;
    chat_name?: string;
    since_utc?: string;
    until_utc?: string;
    limit?: number;
    include_reply_to?: boolean;
    enrich_message_details?: boolean;
    max_messages?: number;
    max_enrich_requests?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

function parseOptionalIsoUtc(value: unknown, fieldName: string): string | undefined {
    const s = asString(value);
    if (s == null || s.trim() === '') return undefined;
    const d = new Date(s);
    assert(!Number.isNaN(d.getTime()), `Invalid ISO date for ${fieldName}: ${s}`);
    return d.toISOString();
}

export function normalizeMetaConversationsApiConfig(raw: unknown): MetaConversationsApiConfig {
    assert(isRecord(raw), 'Meta Conversations API config must be a JSON object');

    const surface = asString(raw.surface);
    assert(surface === 'FB_MESSENGER' || surface === 'INSTAGRAM', 'config.surface must be FB_MESSENGER or INSTAGRAM');

    const conversation_id = asString(raw.conversation_id);
    assert(conversation_id && conversation_id.trim() !== '', 'config.conversation_id is required');

    const limit = asNumber(raw.limit);
    if (limit != null) assert(limit > 0 && limit <= 200, 'config.limit must be between 1 and 200');

    const max_messages = asNumber(raw.max_messages);
    if (max_messages != null) assert(max_messages >= 0, 'config.max_messages must be >= 0');

    const max_enrich_requests = asNumber(raw.max_enrich_requests);
    if (max_enrich_requests != null) assert(max_enrich_requests >= 0, 'config.max_enrich_requests must be >= 0');

    return {
        surface,
        conversation_id,
        account_id: asString(raw.account_id),
        chat_name: asString(raw.chat_name),
        since_utc: parseOptionalIsoUtc(raw.since_utc, 'since_utc'),
        until_utc: parseOptionalIsoUtc(raw.until_utc, 'until_utc'),
        limit,
        include_reply_to: asBoolean(raw.include_reply_to),
        enrich_message_details: asBoolean(raw.enrich_message_details),
        max_messages,
        max_enrich_requests,
    };
}

export async function loadMetaConversationsApiConfig(configPath: string): Promise<MetaConversationsApiConfig> {
    const file = Bun.file(configPath);
    const exists = await file.exists();
    assert(exists, `Meta Conversations API config not found: ${configPath}`);
    const raw = (await file.json()) as unknown;
    return normalizeMetaConversationsApiConfig(raw);
}

type MetaPaging = {
    next?: string;
};

type MetaListResponse<T> = {
    data?: T[];
    paging?: MetaPaging;
};

type MetaUser = {
    id?: string;
    name?: string;
};

type MetaMessageListItem = {
    id?: string;
    created_time?: string;
    from?: MetaUser;
    message?: string;
};

type MetaReplyTo = {
    mid?: string;
    is_self_reply?: boolean;
};

type MetaMessageDetail = {
    id?: string;
    created_time?: string;
    from?: MetaUser;
    message?: string;
    reply_to?: MetaReplyTo;
    attachments?: { data?: unknown[] };
};

function toIsoUtc(dateLike: string | undefined): string {
    if (!dateLike) return new Date(0).toISOString();
    const d = new Date(dateLike);
    if (Number.isNaN(d.getTime())) return new Date(0).toISOString();
    return d.toISOString();
}

function safeString(value: string | undefined, fallback: string): string {
    return value && value.trim() !== '' ? value : fallback;
}

export class MetaConversationsApiAdapter extends BaseAdapter {
    readonly platform = Platform.META_CONVERSATIONS_API;

    private readonly config: MetaConversationsApiConfig;

    constructor(opts: { config: MetaConversationsApiConfig }) {
        super();
        this.config = opts.config;
    }

    async *parseMessages(input: AdapterInput): AsyncGenerator<IUnifiedMessage> {
        void input;
        const config = this.config;

        const fixtureDir = process.env.META_API_FIXTURE_DIR;
        const accessToken = process.env.META_ACCESS_TOKEN;
        const graphApiVersion = process.env.META_GRAPH_API_VERSION ?? 'v21.0';

        if (!fixtureDir) {
            assert(accessToken && accessToken.trim() !== '', 'META_ACCESS_TOKEN is required for Meta Conversations API adapter');
        }

        const limit = config.limit ?? 50;
        const includeReplyTo = config.include_reply_to ?? true;
        const enrichMessageDetails = config.enrich_message_details ?? true;

        const sinceUnix = config.since_utc ? Math.floor(new Date(config.since_utc).getTime() / 1000) : undefined;
        const untilUnix = config.until_utc ? Math.floor(new Date(config.until_utc).getTime() / 1000) : undefined;

        let listUrl: string | undefined = this.buildMessagesListUrl({
            graphApiVersion,
            conversationId: config.conversation_id,
            limit,
            sinceUnix,
            untilUnix,
            accessToken,
        });

        let yielded = 0;
        let enrichRequests = 0;

        while (listUrl) {
            const page = await this.fetchJson<MetaListResponse<MetaMessageListItem>>(listUrl, fixtureDir);
            const data = Array.isArray(page.data) ? page.data : [];

            for (const item of data) {
                if (config.max_messages != null && yielded >= config.max_messages) return;

                const id = asString(item.id);
                if (!id) continue;

                let detail: MetaMessageDetail | undefined;
                const canEnrich =
                    enrichMessageDetails && (config.max_enrich_requests == null || enrichRequests < config.max_enrich_requests);

                if (canEnrich) {
                    try {
                        detail = await this.fetchMessageDetail({ graphApiVersion, messageId: id, accessToken, fixtureDir });
                        enrichRequests++;
                    } catch {
                        detail = undefined;
                    }
                }

                const createdTime = asString(detail?.created_time) ?? asString(item.created_time);
                const from = (detail?.from ?? item.from) as MetaUser | undefined;

                const replyToMid = includeReplyTo ? asString(detail?.reply_to?.mid) : undefined;
                const hasAttachment = Array.isArray(detail?.attachments?.data) && detail!.attachments!.data!.length > 0;

                const messageText = asString(detail?.message) ?? asString(item.message) ?? '';

                const unified: IUnifiedMessage = {
                    message_id: id,
                    timestamp_utc: toIsoUtc(createdTime),
                    sender: {
                        id: safeString(asString(from?.id), 'unknown'),
                        original_name: safeString(asString(from?.name), 'Unknown'),
                    },
                    content: messageText,
                    context: {
                        reply_to_message_id: replyToMid ?? null,
                        thread_id: null,
                        forwarded_from: null,
                    },
                    metadata: {
                        has_attachment: hasAttachment,
                        is_edited: false,
                        is_deleted: false,
                        is_system: false,
                    },
                };

                yielded++;
                yield unified;
            }

            listUrl = asString(page.paging?.next);
        }
    }

    private buildMessagesListUrl(opts: {
        graphApiVersion: string;
        conversationId: string;
        limit: number;
        sinceUnix?: number;
        untilUnix?: number;
        accessToken?: string;
    }): string {
        // NOTE: Using access_token query param for simplicity.
        const url = new URL(`https://graph.facebook.com/${opts.graphApiVersion}/${opts.conversationId}/messages`);
        url.searchParams.set('limit', String(opts.limit));
        url.searchParams.set('fields', 'id,created_time,from,message');
        if (opts.sinceUnix != null) url.searchParams.set('since', String(opts.sinceUnix));
        if (opts.untilUnix != null) url.searchParams.set('until', String(opts.untilUnix));
        if (opts.accessToken) url.searchParams.set('access_token', opts.accessToken);
        return url.toString();
    }

    private async fetchMessageDetail(opts: {
        graphApiVersion: string;
        messageId: string;
        accessToken?: string;
        fixtureDir?: string;
    }): Promise<MetaMessageDetail> {
        const url = new URL(`https://graph.facebook.com/${opts.graphApiVersion}/${opts.messageId}`);
        url.searchParams.set('fields', 'id,created_time,from,message,reply_to,attachments');
        if (opts.accessToken) url.searchParams.set('access_token', opts.accessToken);
        return await this.fetchJson<MetaMessageDetail>(url.toString(), opts.fixtureDir);
    }

    private async fetchJson<T>(url: string, fixtureDir?: string): Promise<T> {
        if (fixtureDir) {
            return (await this.fetchJsonFromFixtures(url, fixtureDir)) as T;
        }

        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`Meta API request failed: ${res.status} ${res.statusText}${body ? `\n${body}` : ''}`);
        }
        return (await res.json()) as T;
    }

    private async fetchJsonFromFixtures(url: string, fixtureDir: string): Promise<unknown> {
        const u = new URL(url);
        const path = u.pathname.replace(/^\//, '');
        const parts = path.split('/');

        // Expected:
        //  /vXX.X/<conversationId>/messages?page=N
        //  /vXX.X/<messageId>
        const version = parts[0];
        const idOrConversation = parts[1];
        const maybeMessages = parts[2];

        assert(version, 'Fixture URL missing version');
        assert(idOrConversation, 'Fixture URL missing identifier');

        let filename: string;

        if (maybeMessages === 'messages') {
            const page = u.searchParams.get('page') ?? '1';
            filename = `conversation_${idOrConversation}.messages.page${page}.json`;
        } else {
            filename = `message_${idOrConversation}.json`;
        }

        const filePath = `${fixtureDir.replace(/\/$/, '')}/${filename}`;
        const file = Bun.file(filePath);
        const exists = await file.exists();
        assert(exists, `Missing Meta API fixture file: ${filePath}`);
        return (await file.json()) as unknown;
    }
}
