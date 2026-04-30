import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

async function runCli(args: string[]): Promise<number> {
    const proc = Bun.spawn(['bun', 'run', 'src/cli/index.ts', ...args], {
        stdout: 'inherit',
        stderr: 'inherit',
    });

    return proc.exited;
}

async function readUnifiedJsonMessagesCount(path: string): Promise<number> {
    const text = await Bun.file(path).text();
    const obj = JSON.parse(text) as { messages?: unknown };
    assert(Array.isArray(obj.messages), 'Expected output JSON to contain messages[]');
    return obj.messages.length;
}

async function main(): Promise<void> {
    const fixturePath = 'tests/fixtures/discord/discord_chat_exporter.sample.json';

    const outDir = await mkdtemp(join(tmpdir(), 'unified-chat-exporter.dedup.'));
    const baseline = join(outDir, 'baseline.json');
    const delta = join(outDir, 'delta.json');

    const exit1 = await runCli([
        'convert',
        '--input',
        fixturePath,
        '--platform',
        'DISCORD',
        '--output-format',
        'json',
        '--output',
        baseline,
        '--chat-name',
        'Dedup fixture',
        '--chat-type',
        'GROUP',
    ]);
    assert(exit1 === 0, `Baseline export failed with exit code: ${exit1}`);

    const baselineCount = await readUnifiedJsonMessagesCount(baseline);
    assert(baselineCount > 0, 'Expected baseline to contain messages');

    const exit2 = await runCli([
        'convert',
        '--input',
        fixturePath,
        '--platform',
        'DISCORD',
        '--output-format',
        'json',
        '--output',
        delta,
        '--dedup-against',
        baseline,
        '--chat-name',
        'Dedup fixture',
        '--chat-type',
        'GROUP',
    ]);
    assert(exit2 === 0, `Dedup export failed with exit code: ${exit2}`);

    const deltaCount = await readUnifiedJsonMessagesCount(delta);
    assert(deltaCount === 0, `Expected zero net-new messages, got ${deltaCount}`);

    // Directory-mode dedup against chunked output
    const chunkDir = join(outDir, 'chunks');
    const exitChunks = await runCli([
        'convert',
        '--input',
        'tests/fixtures/discord/discord_chat_exporter.chunking.sample.json',
        '--platform',
        'DISCORD',
        '--output-format',
        'json',
        '--output',
        chunkDir,
        '--chunk-by',
        'month',
        '--chat-name',
        'Chunk dedup fixture',
        '--chat-type',
        'GROUP',
    ]);
    assert(exitChunks === 0, `Chunked baseline export failed with exit code: ${exitChunks}`);

    const delta2 = join(outDir, 'delta2.json');
    const exit3 = await runCli([
        'convert',
        '--input',
        'tests/fixtures/discord/discord_chat_exporter.chunking.sample.json',
        '--platform',
        'DISCORD',
        '--output-format',
        'json',
        '--output',
        delta2,
        '--dedup-against',
        chunkDir,
        '--chat-name',
        'Chunk dedup fixture',
        '--chat-type',
        'GROUP',
    ]);
    assert(exit3 === 0, `Directory dedup export failed with exit code: ${exit3}`);

    const delta2Count = await readUnifiedJsonMessagesCount(delta2);
    assert(delta2Count === 0, `Expected zero net-new messages vs chunk dir, got ${delta2Count}`);

    // Best-effort cleanup
    try {
        await rm(outDir, { recursive: true, force: true });
    } catch {
        // ignore
    }
}

main().catch((err) => {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
