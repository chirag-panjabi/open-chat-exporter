import { createWriteStream } from 'node:fs';
import type { Writable } from 'node:stream';
import type { IChatInfo, IExportMeta, IUnifiedMessage } from '../types';

async function writeWithBackpressure(stream: Writable, chunk: string): Promise<void> {
  const ok = stream.write(chunk);
  if (ok) return;
  await new Promise<void>((resolve, reject) => {
    stream.once('drain', resolve);
    stream.once('error', reject);
  });
}

export async function writeUnifiedExportJson(params: {
  exportMeta: IExportMeta;
  chatInfo: IChatInfo;
  messages: AsyncIterable<IUnifiedMessage>;
  outputPath?: string;
}): Promise<void> {
  const stream: Writable = params.outputPath
    ? createWriteStream(params.outputPath, { encoding: 'utf-8' })
    : (process.stdout as unknown as Writable);

  const exportMetaJson = JSON.stringify(params.exportMeta);
  const chatInfoJson = JSON.stringify(params.chatInfo);

  await writeWithBackpressure(
    stream,
    `{"export_meta":${exportMetaJson},"chat_info":${chatInfoJson},"messages":[\n`
  );

  let first = true;
  for await (const message of params.messages) {
    const messageJson = JSON.stringify(message);
    const prefix = first ? '' : ',\n';
    first = false;
    await writeWithBackpressure(stream, `${prefix}${messageJson}`);
  }

  await writeWithBackpressure(stream, `\n]}\n`);

  if (params.outputPath) {
    await new Promise<void>((resolve, reject) => {
      stream.once('finish', resolve);
      stream.once('error', reject);
      stream.end();
    });
  }
}
