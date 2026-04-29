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
    const fixturePath = 'tests/fixtures/meta_conversations_api/meta_conversations_api.config.sample.json';
    const outputPath = join(tmpdir(), `unified-chat-exporter.meta_conversations_api.${Date.now()}.json`);

    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'src/cli/index.ts',
            'convert',
            '--input',
            fixturePath,
            '--platform',
            'META_CONVERSATIONS_API',
            '--output',
            outputPath,
            '--chat-type',
            'GROUP',
        ],
        {
            stdout: 'inherit',
            stderr: 'inherit',
            env: {
                ...process.env,
                META_API_FIXTURE_DIR: 'tests/fixtures/meta_conversations_api',
                META_GRAPH_API_VERSION: 'v21.0',
            },
        }
    );

    const exitCode = await proc.exited;
    assert(exitCode === 0, `CLI failed with exit code: ${exitCode}`);

    const chatInfo = await readPickedValue(outputPath, 'chat_info');
    assert(isRecord(chatInfo), 'chat_info should be an object');
    assert(chatInfo.platform === 'FB_MESSENGER', 'chat_info.platform should be FB_MESSENGER (surface override)');
    assert(chatInfo.chat_name === 'Meta Conversations API fixture', 'chat_info.chat_name should come from config');

    const messages = await readMessages(outputPath);
    assert(messages.length === 3, `Expected 3 messages, got ${messages.length}`);

    const replied = messages.find((m) => isRecord(m.context) && m.context.reply_to_message_id === 'm1');
    assert(replied, 'Expected at least one message with reply_to_message_id = m1');

    const hasAttachment = messages.find((m) => isRecord(m.metadata) && m.metadata.has_attachment === true);
    assert(hasAttachment, 'Expected at least one attachment message');

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
