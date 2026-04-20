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
    const fixturePath = 'tests/fixtures/whatsapp/whatsapp_txt.sample.txt';
    const outputPath = join(tmpdir(), `unified-chat-exporter.whatsapp.${Date.now()}.json`);

    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'src/cli/index.ts',
            'convert',
            '--input',
            fixturePath,
            '--platform',
            'WHATSAPP',
            '--output',
            outputPath,
            '--chat-name',
            'WhatsApp fixture',
            '--chat-type',
            'GROUP',
        ],
        { stdout: 'inherit', stderr: 'inherit' }
    );

    const exitCode = await proc.exited;
    assert(exitCode === 0, `CLI failed with exit code: ${exitCode}`);

    const chatInfo = await readPickedValue(outputPath, 'chat_info');
    assert(isRecord(chatInfo), 'chat_info should be an object');
    assert(chatInfo.platform === 'WHATSAPP', 'chat_info.platform should be WHATSAPP');
    assert(chatInfo.chat_name === 'WhatsApp fixture', 'chat_info.chat_name should match override');

    const messages = await readMessages(outputPath);
    assert(messages.length === 5, `Expected 5 messages, got ${messages.length}`);

    const multiline = messages.find((m) => isRecord(m.sender) && m.sender.original_name === 'Bob' && typeof m.content === 'string' && m.content.includes('\n'));
    assert(multiline, 'Expected multiline message from Bob');
    assert(typeof multiline.content === 'string', 'Multiline message content should be a string');
    assert(
        multiline.content.includes('Second line of the same message.'),
        'Multiline continuation not preserved'
    );
    assert(isRecord(multiline.context), 'Multiline message context should be an object');
    assert(multiline.context.reply_to_message_id === null, 'reply_to_message_id must be null for WhatsApp TXT');

    const systemMsg = messages.find((m) => isRecord(m.metadata) && m.metadata.is_system === true);
    assert(systemMsg, 'Expected at least one system message');

    const mediaMsg = messages.find((m) => isRecord(m.metadata) && m.metadata.has_attachment === true);
    assert(mediaMsg, 'Expected at least one attachment message');
    assert(typeof mediaMsg.content === 'string', 'Attachment message content should be a string');

    const deletedMsg = messages.find((m) => isRecord(m.metadata) && m.metadata.is_deleted === true);
    assert(deletedMsg, 'Expected at least one deleted message');

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
