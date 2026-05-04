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

async function main(): Promise<void> {
    const fixturePath = 'tests/fixtures/scrub/discord_for_scrub.sample.json';
    const identitiesPath = 'tests/fixtures/scrub/identities.sample.yaml';

    const mdOut = join(tmpdir(), `open-chat-exporter.scrub.${Date.now()}.md`);
    const csvOut = join(tmpdir(), `open-chat-exporter.scrub.${Date.now()}.csv`);

    const exitMd = await runCli([
        'convert',
        '--input',
        fixturePath,
        '--platform',
        'DISCORD',
        '--output-format',
        'md',
        '--output',
        mdOut,
        '--chat-name',
        'Scrub fixture',
        '--identities',
        identitiesPath,
        '--anonymize',
        '--drop-system',
    ]);
    assert(exitMd === 0, `Markdown CLI failed with exit code: ${exitMd}`);

    const mdText = await Bun.file(mdOut).text();
    assert(mdText.includes('[User_Alice]'), 'Expected resolved_name to appear in Markdown');
    assert(!mdText.includes('Alice#1234'), 'Expected alias to be anonymized in Markdown');
    assert(!mdText.includes('A message was pinned.'), 'Expected system message to be dropped in Markdown');

    const exitCsv = await runCli([
        'convert',
        '--input',
        fixturePath,
        '--platform',
        'DISCORD',
        '--output-format',
        'csv',
        '--output',
        csvOut,
        '--chat-name',
        'Scrub fixture',
        '--identities',
        identitiesPath,
        '--anonymize',
        '--drop-system',
    ]);
    assert(exitCsv === 0, `CSV CLI failed with exit code: ${exitCsv}`);

    const csvText = await Bun.file(csvOut).text();
    const [header, ...rows] = csvText.trimEnd().split('\n');
    assert(header.startsWith('message_id,timestamp_utc,'), 'CSV header mismatch');
    assert(rows.length === 2, `Expected 2 CSV rows (system dropped), got ${rows.length}`);
    assert(csvText.includes('[User_Alice]'), 'Expected resolved_name to appear in CSV');
    assert(!csvText.includes('Hi Alice#1234'), 'Expected alias to be anonymized in CSV content');
    assert(!csvText.includes('Replying to Alice#1234'), 'Expected alias to be anonymized in CSV content');

    // Best-effort cleanup
    try {
        await Bun.file(mdOut).delete();
    } catch {
        // ignore
    }
    try {
        await Bun.file(csvOut).delete();
    } catch {
        // ignore
    }
}

main().catch((err) => {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
