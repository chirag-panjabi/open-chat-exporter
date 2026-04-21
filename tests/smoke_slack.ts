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
    const fixturePath = 'tests/fixtures/slack/messages.sample.json';
    const outputPath = join(tmpdir(), `unified-chat-exporter.slack.${Date.now()}.json`);

    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'src/cli/index.ts',
            'convert',
            '--input',
            fixturePath,
            '--platform',
            'SLACK',
            '--output',
            outputPath,
            '--chat-name',
            'Slack fixture',
            '--chat-type',
            'GROUP',
        ],
        { stdout: 'inherit', stderr: 'inherit' }
    );

    const exitCode = await proc.exited;
    assert(exitCode === 0, `CLI failed with exit code: ${exitCode}`);

    const chatInfo = await readPickedValue(outputPath, 'chat_info');
    assert(isRecord(chatInfo), 'chat_info should be an object');
    assert(chatInfo.platform === 'SLACK', 'chat_info.platform should be SLACK');
    assert(chatInfo.chat_name === 'Slack fixture', 'chat_info.chat_name should match override');

    const messages = await readMessages(outputPath);
    assert(messages.length === 4, `Expected 4 messages, got ${messages.length}`);

    const m1 = messages.find((m) => m.message_id === '1710000000.000100');
    assert(m1, 'Expected message 1 to exist');
    assert(typeof m1.timestamp_utc === 'string' && m1.timestamp_utc.endsWith('Z'), 'Expected timestamp_utc to be ISO');
    assert(m1.content === 'Hello from Slack fixture.', 'Message 1 content mismatch');
    assert(isRecord(m1.interactions), 'Message 1 should have interactions');

    const reactions = (m1.interactions as Record<string, unknown>).reactions;
    assert(Array.isArray(reactions), 'Message 1 reactions should be an array');
    assert(reactions.length === 1, 'Message 1 should have 1 reaction');
    assert(
        isRecord(reactions[0]) && reactions[0].emoji === ':thumbsup:' && reactions[0].count === 2,
        'Message 1 reaction mismatch'
    );

    const m2 = messages.find((m) => m.message_id === '1710000001.000200');
    assert(m2, 'Expected message 2 to exist');
    assert(isRecord(m2.context), 'Message 2 context should be an object');
    assert(m2.context.thread_id === '1710000000.000100', 'Message 2 thread_id mismatch');
    assert(m2.context.reply_to_message_id === '1710000000.000100', 'Message 2 reply_to_message_id mismatch');

    const m3 = messages.find((m) => m.message_id === '1710000002.000300');
    assert(m3, 'Expected message 3 to exist');
    assert(isRecord(m3.metadata), 'Message 3 metadata should be an object');
    assert(m3.metadata.has_attachment === true, 'Expected has_attachment true');
    assert(m3.metadata.is_edited === true, 'Expected is_edited true');

    const system = messages.find((m) => isRecord(m.metadata) && m.metadata.is_system === true);
    assert(system, 'Expected at least one system message');

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
