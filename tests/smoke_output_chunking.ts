import { mkdtemp, rm, readdir, stat } from 'node:fs/promises';
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

async function listFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir);
    return entries.slice().sort();
}

async function main(): Promise<void> {
    const outDir = await mkdtemp(join(tmpdir(), 'open-chat-exporter.chunk.'));

    const fixturePath = 'tests/fixtures/discord/discord_chat_exporter.chunking.sample.json';

    // First run (JSON): should create one file per month.
    const exit1 = await runCli([
        'convert',
        '--input',
        fixturePath,
        '--platform',
        'DISCORD',
        '--output-format',
        'json',
        '--output',
        outDir,
        '--chunk-by',
        'month',
        '--chat-name',
        'Chunk fixture',
        '--chat-type',
        'GROUP',
    ]);
    assert(exit1 === 0, `Chunked JSON CLI failed with exit code: ${exit1}`);

    const files1 = await listFiles(outDir);
    const jsonFiles1 = files1.filter((f) => f.endsWith('.json'));
    assert(jsonFiles1.length === 2, `Expected 2 JSON chunk files, got ${jsonFiles1.length}`);
    assert(
        jsonFiles1.some((f) => f.includes('.chunk.2024-01.')),
        `Expected a January chunk file, got: ${jsonFiles1.join(', ')}`
    );
    assert(
        jsonFiles1.some((f) => f.includes('.chunk.2024-02.')),
        `Expected a February chunk file, got: ${jsonFiles1.join(', ')}`
    );

    // Collision behavior (JSON): second run without --overwrite should fail (files exist).
    const exit2 = await runCli([
        'convert',
        '--input',
        fixturePath,
        '--platform',
        'DISCORD',
        '--output-format',
        'json',
        '--output',
        outDir,
        '--chunk-by',
        'month',
        '--chat-name',
        'Chunk fixture',
        '--chat-type',
        'GROUP',
    ]);
    assert(exit2 !== 0, `Expected collision failure without --overwrite, got exit code: ${exit2}`);

    // With --overwrite it should succeed.
    const exit3 = await runCli([
        'convert',
        '--input',
        fixturePath,
        '--platform',
        'DISCORD',
        '--output-format',
        'json',
        '--output',
        outDir,
        '--chunk-by',
        'month',
        '--overwrite',
        '--chat-name',
        'Chunk fixture',
        '--chat-type',
        'GROUP',
    ]);
    assert(exit3 === 0, `Expected overwrite success, got exit code: ${exit3}`);

    // Sanity: output dir still exists and contains files.
    const dirStat = await stat(outDir);
    assert(dirStat.isDirectory(), 'Expected output path to be a directory');
    const files2 = await listFiles(outDir);
    const jsonFiles2 = files2.filter((f) => f.endsWith('.json'));
    assert(jsonFiles2.length === 2, `Expected 2 JSON chunk files after overwrite, got ${jsonFiles2.length}`);

    // Markdown chunking should also work (in a separate directory).
    const outDirMd = await mkdtemp(join(tmpdir(), 'open-chat-exporter.chunk-md.'));
    const exitMd = await runCli([
        'convert',
        '--input',
        fixturePath,
        '--platform',
        'DISCORD',
        '--output-format',
        'md',
        '--output',
        outDirMd,
        '--chunk-by',
        'month',
        '--chat-name',
        'Chunk fixture',
        '--chat-type',
        'GROUP',
    ]);
    assert(exitMd === 0, `Chunked Markdown CLI failed with exit code: ${exitMd}`);

    const mdFiles = (await listFiles(outDirMd)).filter((f) => f.endsWith('.md'));
    assert(mdFiles.length === 2, `Expected 2 Markdown chunk files, got ${mdFiles.length}`);
    assert(mdFiles.some((f) => f.includes('.chunk.2024-01.')), 'Expected a January Markdown chunk file');
    assert(mdFiles.some((f) => f.includes('.chunk.2024-02.')), 'Expected a February Markdown chunk file');

    // Best-effort cleanup
    try {
        await rm(outDir, { recursive: true, force: true });
    } catch {
        // ignore
    }
    try {
        await rm(outDirMd, { recursive: true, force: true });
    } catch {
        // ignore
    }
}

main().catch((err) => {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
