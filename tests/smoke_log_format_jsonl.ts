import { tmpdir } from 'node:os';
import { join } from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

type LogEvent = {
    type: string;
    ts?: string;
    [k: string]: unknown;
};

function parseJsonl(text: string): LogEvent[] {
    const out: LogEvent[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;

        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`Expected JSONL line but failed to parse: ${msg}\nLine: ${line}`, { cause: err });
        }

        assert(isRecord(parsed), 'Expected JSONL object');
        assert(typeof parsed.type === 'string' && parsed.type.length > 0, 'Expected event.type to be a non-empty string');
        assert(typeof parsed.ts === 'string' && parsed.ts.length > 0, 'Expected event.ts to be a non-empty string');

        out.push(parsed as LogEvent);
    }
    return out;
}

async function readProcStderr(proc: Bun.Subprocess): Promise<string> {
    const stderr = proc.stderr;
    assert(stderr != null, 'Expected proc.stderr to be available');
    assert(typeof stderr !== 'number', 'Expected proc.stderr to be a ReadableStream (piped)');
    return await new Response(stderr).text();
}

async function runSuccessCase(): Promise<void> {
    const fixturePath = 'tests/fixtures/whatsapp/whatsapp_lenient_invalid_timestamp.sample.txt';
    const outputPath = join(tmpdir(), `unified-chat-exporter.jsonl.${Date.now()}.json`);

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
            'minimal',
            '--lenient',
            '--log-format',
            'jsonl',
        ],
        { stdout: 'inherit', stderr: 'pipe' }
    );

    const exitCode = await proc.exited;
    const stderrText = await readProcStderr(proc);

    assert(exitCode === 0, `CLI failed with exit code: ${exitCode}\nStderr:\n${stderrText}`);

    const events = parseJsonl(stderrText);
    const types = new Set(events.map((e) => e.type));

    assert(types.has('start'), 'Expected a start event');
    assert(types.has('warning'), 'Expected at least one warning event (lenient fixture)');
    assert(types.has('progress'), 'Expected at least one progress event');
    assert(types.has('finish'), 'Expected a finish event');
    assert(!types.has('fatal'), 'Did not expect a fatal event in success case');

    const outFile = Bun.file(outputPath);
    assert(await outFile.exists(), 'Expected output file to exist');
    assert(outFile.size > 0, 'Expected output file to be non-empty');

    // Best-effort cleanup
    try {
        await outFile.delete();
    } catch {
        // ignore
    }
}

async function runFatalCase(): Promise<void> {
    const proc = Bun.spawn(
        ['bun', 'run', 'src/cli/index.ts', 'convert', '--platform', 'WHATSAPP', '--log-format', 'jsonl'],
        { stdout: 'inherit', stderr: 'pipe' }
    );

    const exitCode = await proc.exited;
    const stderrText = await readProcStderr(proc);

    assert(exitCode !== 0, `Expected non-zero exit code, got: ${exitCode}`);

    const events = parseJsonl(stderrText);
    assert(events.some((e) => e.type === 'fatal'), 'Expected a fatal event');
    assert(
        events.some((e) => e.type === 'fatal' && e.code === 'MISSING_INPUT'),
        'Expected fatal event code to be MISSING_INPUT'
    );
}

async function main(): Promise<void> {
    await runSuccessCase();
    await runFatalCase();
}

main().catch((err) => {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
