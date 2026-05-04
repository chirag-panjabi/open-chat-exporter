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
  const fixturePath = 'tests/fixtures/fb_messenger/messenger.sample.json';
  const outputPath = join(tmpdir(), `open-chat-exporter.fb_messenger.${Date.now()}.json`);

  const proc = Bun.spawn(
    [
      'bun',
      'run',
      'src/cli/index.ts',
      'convert',
      '--input',
      fixturePath,
      '--platform',
      'FB_MESSENGER',
      '--output',
      outputPath,
      '--chat-name',
      'Messenger fixture',
      '--chat-type',
      'GROUP',
    ],
    { stdout: 'inherit', stderr: 'inherit' }
  );

  const exitCode = await proc.exited;
  assert(exitCode === 0, `CLI failed with exit code: ${exitCode}`);

  const chatInfo = await readPickedValue(outputPath, 'chat_info');
  assert(isRecord(chatInfo), 'chat_info should be an object');
  assert(chatInfo.platform === 'FB_MESSENGER', 'chat_info.platform should be FB_MESSENGER');
  assert(chatInfo.chat_name === 'Messenger fixture', 'chat_info.chat_name should match override');

  const messages = await readMessages(outputPath);
  assert(messages.length === 4, `Expected 4 messages, got ${messages.length}`);

  const m1 = messages.find((m) => typeof m.content === 'string' && m.content.includes('Hello from Messenger fixture.'));
  assert(m1, 'Expected message 1 to exist');
  assert(isRecord(m1.metadata), 'Message 1 metadata should be an object');
  assert(m1.metadata.has_attachment === false, 'Message 1 should have no attachment');
  assert(isRecord(m1.interactions), 'Message 1 should have interactions');

  const reactions = (m1.interactions as Record<string, unknown>).reactions;
  assert(Array.isArray(reactions), 'Message 1 reactions should be an array');
  assert(reactions.length === 1, 'Message 1 should have 1 aggregated reaction');
  assert(isRecord(reactions[0]), 'Reaction entry should be an object');
  assert(reactions[0].emoji === '👍', 'Reaction emoji mismatch');
  assert(reactions[0].count === 2, 'Reaction count mismatch');

  const attachment = messages.find((m) => isRecord(m.metadata) && m.metadata.has_attachment === true);
  assert(attachment, 'Expected at least one attachment message');

  const deleted = messages.find((m) => isRecord(m.metadata) && m.metadata.is_deleted === true);
  assert(deleted, 'Expected at least one deleted/unsent message');

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
