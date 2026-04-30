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
  const fixturePath = 'tests/fixtures/whatsapp/whatsapp_lenient_invalid_timestamp.sample.txt';
  const outputPath = join(tmpdir(), `unified-chat-exporter.whatsapp.lenient.${Date.now()}.json`);
  const reportPath = join(tmpdir(), `unified-chat-exporter.whatsapp.lenient.${Date.now()}.report.json`);

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
      '--output-format',
      'json',
      '--output-profile',
      'canonical',
      '--chat-name',
      'WhatsApp lenient fixture',
      '--chat-type',
      'GROUP',
      '--lenient',
      '--report-json',
      reportPath,
    ],
    { stdout: 'inherit', stderr: 'inherit' }
  );

  const exitCode = await proc.exited;
  assert(exitCode === 0, `CLI failed with exit code: ${exitCode}`);

  const chatInfo = await readPickedValue(outputPath, 'chat_info');
  assert(isRecord(chatInfo), 'chat_info should be an object');
  assert(chatInfo.platform === 'WHATSAPP', 'chat_info.platform should be WHATSAPP');

  const messages = await readMessages(outputPath);
  // Our lenient behavior treats the invalid header-like line as a continuation of the prior message.
  assert(messages.length === 2, `Expected 2 messages, got ${messages.length}`);

  const first = messages[0];
  assert(isRecord(first.sender), 'First message sender should be an object');
  assert(first.sender.original_name === 'Alice', 'First message sender mismatch');
  assert(
    typeof first.content === 'string' && first.content.includes('invalid date'),
    'Expected first message to include the invalid header-like line as continuation'
  );

  const report = (await Bun.file(reportPath).json()) as unknown;
  assert(isRecord(report), 'report should be an object');
  assert(isRecord(report.warnings), 'report.warnings should exist');
  assert(report.warnings.count === 1, `Expected warnings.count === 1, got ${String(report.warnings.count)}`);

  // Best-effort cleanup
  try {
    await Bun.file(outputPath).delete();
  } catch {
    // ignore
  }
  try {
    await Bun.file(reportPath).delete();
  } catch {
    // ignore
  }
}

main().catch((err) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
