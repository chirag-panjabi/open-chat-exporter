import type { IUnifiedMessage } from '../types';

export type IdentityEntry = {
    resolved_name: string;
    aliases: string[];
};

export type IdentitiesFile = {
    identities: IdentityEntry[];
};

export type ScrubOptions = {
    identities?: IdentitiesFile;
    anonymize?: boolean;
    sinceUtc?: string;
    untilUtc?: string;
    dropSystem?: boolean;
    minContentLength?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const out: string[] = [];
    for (const item of value) {
        if (typeof item === 'string') out.push(item);
    }
    return out;
}

export function normalizeIdentitiesFile(raw: unknown): IdentitiesFile {
    if (!isRecord(raw)) throw new Error('identities.yaml must parse to an object');

    const identitiesRaw = raw.identities;
    if (!Array.isArray(identitiesRaw)) {
        return { identities: [] };
    }

    const identities: IdentityEntry[] = [];
    for (const item of identitiesRaw) {
        if (!isRecord(item)) continue;
        const resolved_name = asString(item.resolved_name);
        const aliases = asStringArray(item.aliases) ?? [];
        if (!resolved_name || resolved_name.trim() === '') continue;
        identities.push({ resolved_name, aliases: aliases.filter((a) => a.trim() !== '') });
    }

    return { identities };
}

function escapeRegExpLiteral(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeBoundaryRegex(literal: string): RegExp {
    // Boundary-aware match without lookbehind, using a captured prefix.
    // - Uses Unicode properties so non-ASCII letters/numbers behave reasonably.
    // - Replaces only when surrounded by non-word-ish boundaries.
    const escaped = escapeRegExpLiteral(literal);
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'gu');
}

type ReplacementRule = {
    alias: string;
    resolvedName: string;
    regex: RegExp;
};

function buildReplacementRules(identities: IdentitiesFile): ReplacementRule[] {
    const rules: ReplacementRule[] = [];
    for (const identity of identities.identities) {
        for (const alias of identity.aliases) {
            rules.push({ alias, resolvedName: identity.resolved_name, regex: makeBoundaryRegex(alias) });
        }
    }

    // Replace longer aliases first to reduce partial replacement collisions.
    rules.sort((a, b) => b.alias.length - a.alias.length);
    return rules;
}

function buildSenderResolutionMap(identities: IdentitiesFile): Map<string, string> {
    const map = new Map<string, string>();
    for (const identity of identities.identities) {
        for (const alias of identity.aliases) {
            if (!map.has(alias)) map.set(alias, identity.resolved_name);
        }
    }
    return map;
}

function normalizeIsoToMs(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const d = new Date(value);
    const t = d.getTime();
    if (Number.isNaN(t)) throw new Error(`Invalid ISO date: ${value}`);
    return t;
}

function indentMultilineContent(content: string): string {
    const normalized = content.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    if (lines.length <= 1) return normalized;
    return [lines[0], ...lines.slice(1).map((l) => `  ${l}`)].join('\n');
}

export function formatMessageDisplayName(message: IUnifiedMessage): string {
    return message.sender.resolved_name ?? message.sender.original_name;
}

export function formatMessageContentForText(message: IUnifiedMessage): string {
    return indentMultilineContent(message.content);
}

export async function* scrubMessages(
    messages: AsyncIterable<IUnifiedMessage>,
    opts: ScrubOptions
): AsyncGenerator<IUnifiedMessage> {
    const identities = opts.identities;
    const resolutionMap = identities ? buildSenderResolutionMap(identities) : undefined;
    const replacementRules = identities && opts.anonymize ? buildReplacementRules(identities) : undefined;

    const sinceMs = normalizeIsoToMs(opts.sinceUtc);
    const untilMs = normalizeIsoToMs(opts.untilUtc);

    for await (const message of messages) {
        if (opts.dropSystem && message.metadata.is_system) continue;

        const timestampMs = Date.parse(message.timestamp_utc);
        if (!Number.isNaN(timestampMs)) {
            if (sinceMs != null && timestampMs < sinceMs) continue;
            if (untilMs != null && timestampMs > untilMs) continue;
        }

        const trimmed = message.content.trim();
        if (opts.minContentLength != null && trimmed.length < opts.minContentLength) continue;

        let resolvedName: string | undefined;
        if (resolutionMap) {
            resolvedName = resolutionMap.get(message.sender.original_name) ?? resolutionMap.get(message.sender.id);
        }

        let content = message.content;
        if (replacementRules && replacementRules.length > 0) {
            for (const rule of replacementRules) {
                content = content.replace(rule.regex, `$1${rule.resolvedName}`);
            }
        }

        yield {
            ...message,
            sender: {
                ...message.sender,
                resolved_name: resolvedName ?? message.sender.resolved_name,
            },
            content,
        };
    }
}
