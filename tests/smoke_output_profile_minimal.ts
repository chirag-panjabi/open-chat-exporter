import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import chain from 'stream-chain';
import parser from 'stream-json/parser.js';
import streamArray from 'stream-json/streamers/stream-array.js';
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

type StreamArrayChunk = {
  key: number;
  value: unknown;
};

async function readRootArray(filePath: string): Promise<Record<string, unknown>[]> {
  const file = Bun.file(filePath);
  const inputTextStream = Readable.from(iterTextFromWebStream(file.stream()));

  const arrayStream = chain([inputTextStream, parser(), streamArray()]);

  const messages: Record<string, unknown>[] = [];
  for await (const chunk of arrayStream as AsyncIterable<StreamArrayChunk>) {
    if (isRecord(chunk.value)) messages.push(chunk.value);
  }
  return messages;
}

async function main(): Promise<void> {
  const fixturePath = 'tests/fixtures/discord/discord_chat_exporter.sample.json';
  const outputPath = join(tmpdir(), `open-chat-exporter.profile.minimal.${Date.now()}.json`);

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
      '--output-format',
      'json',
      '--output-profile',
      'minimal',
      '--chat-name',
      'Discord fixture',
      '--chat-type',
      'GROUP',
    ],
    { stdout: 'inherit', stderr: 'inherit' }
  );

  const exitCode = await proc.exited;
  assert(exitCode === 0, `CLI failed with exit code: ${exitCode}`);

  const messages = await readRootArray(outputPath);
  assert(messages.length === 3, `Expected 3 messages, got ${messages.length}`);

  const m1 = messages.find((m) => m.message_content === 'Hello from DiscordChatExporter fixture.');
  assert(m1, 'Expected message 1 to exist');
  assert(m1.platform === 'DISCORD', 'platform should be DISCORD');
  assert(m1.sender_name === 'Alice#1234', 'sender_name should be original_name when not resolved');
  assert(
    m1.message_content === 'Hello from DiscordChatExporter fixture.',
    'message_content should match unified content'
  );

  // Best-effort cleanup
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
