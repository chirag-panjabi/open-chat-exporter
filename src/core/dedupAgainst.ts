import { Database } from 'bun:sqlite';
import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { Readable } from 'node:stream';
import chain from 'stream-chain';
import parser from 'stream-json/parser.js';
import pick from 'stream-json/filters/pick.js';
import streamArray from 'stream-json/streamers/stream-array.js';
import type { IUnifiedMessage } from '../types';
import { iterUint8 } from '../utils/streams';

type StreamArrayChunk = {
    key: number;
    value: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

async function* iterTextFromWebStream(
    stream: ReadableStream<Uint8Array>,
    encoding = 'utf-8'
): AsyncGenerator<string> {
    const decoder = new TextDecoder(encoding);

    for await (const chunk of iterUint8(stream)) {
        yield decoder.decode(chunk, { stream: true });
    }

    const tail = decoder.decode();
    if (tail) yield tail;
}

export type DedupStats = {
    prior_files_scanned: number;
    prior_message_ids_indexed: number;
    messages_dropped: number;
    messages_emitted: number;
};

async function* streamMessageIdsFromUnifiedExportJsonFile(filePath: string): AsyncGenerator<string> {
    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) throw new Error(`dedup-against file not found: ${filePath}`);

    const inputTextStream = Readable.from(iterTextFromWebStream(file.stream()));

    const messagesArrayStream = chain([inputTextStream, parser(), pick({ filter: 'messages' }), streamArray()]);

    for await (const chunk of messagesArrayStream as AsyncIterable<StreamArrayChunk>) {
        const message = chunk.value;
        if (!isRecord(message)) continue;

        const messageId = message.message_id;
        if (typeof messageId !== 'string' || messageId.trim() === '') {
            throw new Error(`dedup-against: encountered message without message_id in ${basename(filePath)}`);
        }

        yield messageId;
    }
}

async function listJsonFilesInDir(dirPath: string): Promise<string[]> {
    const entries = await readdir(dirPath);
    const out: string[] = [];

    for (const name of entries) {
        if (!name.toLowerCase().endsWith('.json')) continue;
        const full = join(dirPath, name);
        let s;
        try {
            s = await stat(full);
        } catch {
            continue;
        }
        if (!s.isFile()) continue;
        out.push(full);
    }

    out.sort((a, b) => a.localeCompare(b));
    return out;
}

async function resolveDedupAgainstFiles(path: string): Promise<string[]> {
    const s = await stat(path);
    if (s.isFile()) return [path];
    if (!s.isDirectory()) throw new Error(`dedup-against path must be a file or directory: ${path}`);
    return listJsonFilesInDir(path);
}

function bestEffortDeleteFile(path: string): void {
    try {
        // Bun.file().delete() is async; for cleanup we can fire-and-forget.
        void Bun.file(path).delete();
    } catch {
        // ignore
    }
}

export async function createDedupFilter(params: {
    dedupAgainstPath: string;
}): Promise<{
    filter: (messages: AsyncIterable<IUnifiedMessage>) => AsyncIterable<IUnifiedMessage>;
    stats: DedupStats;
    close: () => void;
}> {
    const files = await resolveDedupAgainstFiles(params.dedupAgainstPath);

    const indexPath = join(
        tmpdir(),
        `open-chat-exporter.dedup-index.${Date.now()}.${Math.random().toString(16).slice(2)}.sqlite`
    );

    const db = new Database(indexPath);
    db.exec('PRAGMA journal_mode=WAL;');
    db.exec('PRAGMA synchronous=NORMAL;');
    db.exec('CREATE TABLE IF NOT EXISTS seen (message_id TEXT PRIMARY KEY) WITHOUT ROWID;');

    const insertStmt = db.prepare('INSERT OR IGNORE INTO seen (message_id) VALUES (?1)');

    // Pass 1: index prior exports.
    db.exec('BEGIN;');
    let inTxn = true;
    let totalProcessed = 0;
    const commitEvery = 5_000;

    try {
        for (const filePath of files) {
            for await (const messageId of streamMessageIdsFromUnifiedExportJsonFile(filePath)) {
                insertStmt.run(messageId);
                totalProcessed++;
                if (totalProcessed % commitEvery === 0) {
                    db.exec('COMMIT;');
                    db.exec('BEGIN;');
                }
            }
        }

        db.exec('COMMIT;');
        inTxn = false;
    } catch (err) {
        try {
            if (inTxn) db.exec('ROLLBACK;');
        } catch {
            // ignore
        }
        throw err;
    }

    const row = db.query('SELECT COUNT(*) as c FROM seen').get() as { c?: number } | null;
    const priorUnique = typeof row?.c === 'number' ? row.c : 0;

    const stats: DedupStats = {
        prior_files_scanned: files.length,
        prior_message_ids_indexed: priorUnique,
        messages_dropped: 0,
        messages_emitted: 0,
    };

    const hasStmt = db.prepare('SELECT 1 as hit FROM seen WHERE message_id = ?1 LIMIT 1');

    const filter = async function* (messages: AsyncIterable<IUnifiedMessage>): AsyncGenerator<IUnifiedMessage> {
        for await (const message of messages) {
            const hit = hasStmt.get(message.message_id) as { hit?: number } | null;
            if (hit?.hit) {
                stats.messages_dropped++;
                continue;
            }

            insertStmt.run(message.message_id);
            stats.messages_emitted++;
            yield message;
        }
    };

    const close = (): void => {
        try {
            db.close();
        } catch {
            // ignore
        }

        bestEffortDeleteFile(indexPath);
        bestEffortDeleteFile(`${indexPath}-wal`);
        bestEffortDeleteFile(`${indexPath}-shm`);
    };

    return { filter, stats, close };
}

export function formatDedupStats(stats: DedupStats): string {
    return (
        `Dedup summary:\n` +
        `- prior_files_scanned: ${stats.prior_files_scanned}\n` +
        `- prior_message_ids_indexed: ${stats.prior_message_ids_indexed}\n` +
        `- messages_dropped: ${stats.messages_dropped}\n` +
        `- messages_emitted: ${stats.messages_emitted}\n`
    );
}

export function isChunkedOutputDirHint(path: string): boolean {
    // Heuristic only (for friendlier error messages).
    return extname(path).toLowerCase() !== '.json';
}
