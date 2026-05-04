import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import chain from 'stream-chain';
import parser from 'stream-json/parser.js';
import pick from 'stream-json/filters/pick.js';
import streamArray from 'stream-json/streamers/stream-array.js';
import streamValues from 'stream-json/streamers/stream-values.js';
import { iterUint8 } from '../src/utils/streams';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

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

type StreamValuesChunk = {
    key: number;
    value: unknown;
};

type StreamArrayChunk = {
    key: number;
    value: unknown;
};

async function readPickedValue(filePath: string, filter: string): Promise<unknown> {
    const file = Bun.file(filePath);
    const inputTextStream = Readable.from(iterTextFromWebStream(file.stream()));

    const valueStream = chain([inputTextStream, parser(), pick({ filter, once: true }), streamValues()]);

    for await (const chunk of valueStream as AsyncIterable<StreamValuesChunk>) {
        return chunk.value;
    }

    throw new Error(`Expected to find JSON value at path: ${filter}`);
}

async function readMessages(filePath: string): Promise<Record<string, unknown>[]> {
    const file = Bun.file(filePath);
    const inputTextStream = Readable.from(iterTextFromWebStream(file.stream()));

    const messagesArrayStream = chain([inputTextStream, parser(), pick({ filter: 'messages' }), streamArray()]);

    const messages: Record<string, unknown>[] = [];
    for await (const chunk of messagesArrayStream as AsyncIterable<StreamArrayChunk>) {
        if (isRecord(chunk.value)) messages.push(chunk.value);
    }

    return messages;
}

async function main(): Promise<void> {
    const fixturePath = 'tests/fixtures/discord/discord_chat_exporter.sample.json';
    const outputPath = join(tmpdir(), `open-chat-exporter.discord.${Date.now()}.json`);

    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'src/cli/index.ts',
            'convert',
            '--input',
            fixturePath,
            '--platform',
            'DISCORD',
            '--output',
            outputPath,
            '--chat-name',
            'Discord fixture',
            '--chat-type',
            'GROUP',
        ],
        { stdout: 'inherit', stderr: 'inherit' }
    );

    const exitCode = await proc.exited;
    assert(exitCode === 0, `CLI failed with exit code: ${exitCode}`);

    const exportMeta = await readPickedValue(outputPath, 'export_meta');
    assert(isRecord(exportMeta), 'export_meta should be an object');
    assert(exportMeta.version === '1.0', 'export_meta.version should be 1.0');

    const chatInfo = await readPickedValue(outputPath, 'chat_info');
    assert(isRecord(chatInfo), 'chat_info should be an object');
    assert(chatInfo.platform === 'DISCORD', 'chat_info.platform should be DISCORD');
    assert(chatInfo.chat_name === 'Discord fixture', 'chat_info.chat_name should match override');

    const messages = await readMessages(outputPath);
    assert(messages.length === 3, `Expected 3 messages, got ${messages.length}`);

    const m1 = messages.find((m) => m.message_id === '100000000000000001');
    assert(m1, 'Expected message 1 to exist');
    assert(isRecord(m1.sender), 'Message 1 sender should be an object');
    assert(m1.sender.original_name === 'Alice#1234', 'Message 1 sender name mismatch');
    assert(m1.content === 'Hello from DiscordChatExporter fixture.', 'Message 1 content mismatch');
    assert(isRecord(m1.metadata), 'Message 1 metadata should be an object');
    assert(m1.metadata.has_attachment === false, 'Message 1 should have no attachment');
    assert(m1.metadata.is_system === false, 'Message 1 should not be system');
    assert(isRecord(m1.interactions), 'Message 1 should have interactions');

    const reactions = (m1.interactions as Record<string, unknown>).reactions;
    assert(Array.isArray(reactions), 'Message 1 reactions should be an array');
    assert(reactions.length === 1, 'Message 1 should have 1 reaction');
    assert(
        isRecord(reactions[0]) && reactions[0].emoji === '👍' && reactions[0].count === 2,
        'Message 1 reaction mismatch'
    );

    const m2 = messages.find((m) => m.message_id === '100000000000000002');
    assert(m2, 'Expected message 2 to exist');
    assert(isRecord(m2.context), 'Message 2 context should be an object');
    assert(
        m2.context.reply_to_message_id === '100000000000000001',
        'Message 2 reply_to_message_id mismatch'
    );
    assert(isRecord(m2.metadata), 'Message 2 metadata should be an object');
    assert(m2.metadata.has_attachment === true, 'Message 2 should have attachment');
    assert(m2.metadata.is_edited === true, 'Message 2 should be edited');
    assert(m2.metadata.is_system === false, 'Message 2 should not be system');

    const m3 = messages.find((m) => m.message_id === '100000000000000003');
    assert(m3, 'Expected message 3 to exist');
    assert(isRecord(m3.metadata), 'Message 3 metadata should be an object');
    assert(m3.metadata.is_system === true, 'Message 3 should be system');

    // Best-effort cleanup (ignore errors)
    try {
        await Bun.file(outputPath).delete();
    } catch {
        // ignore
    }
}

main().catch((err) => {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
