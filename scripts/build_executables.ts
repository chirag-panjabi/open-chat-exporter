import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function parseArgs(argv: string[]): Record<string, string | boolean> {
    const out: Record<string, string | boolean> = {};
    for (let i = 0; i < argv.length; i++) {
        const tok = argv[i];
        if (!tok.startsWith('--')) continue;
        const [flag, inlineValue] = tok.split('=', 2);
        let value: string | undefined = inlineValue;
        if (inlineValue == null) {
            const next = argv[i + 1];
            if (next != null && !next.startsWith('--')) {
                value = next;
                i++;
            }
        }
        const key = flag.replace(/^--/, '');
        out[key] = value ?? true;
    }
    return out;
}

function platformTag(): string {
    const p = process.platform;
    if (p === 'darwin') return 'macos';
    if (p === 'win32') return 'windows';
    if (p === 'linux') return 'linux';
    return p;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const outdir = typeof args.outdir === 'string' ? args.outdir : 'dist';
    const name = typeof args.name === 'string' ? args.name : 'unified-chat-exporter';

    await mkdir(outdir, { recursive: true });

    const os = platformTag();
    const arch = process.arch;
    const ext = process.platform === 'win32' ? '.exe' : '';
    const outfile = join(outdir, `${name}-${os}-${arch}${ext}`);

    const entry = 'src/cli/index.ts';

    const compileArgs = [
        'build',
        '--compile',
        '--outfile',
        outfile,
        '--no-compile-autoload-dotenv',
        '--no-compile-autoload-bunfig',
        '--no-compile-autoload-package-json',
        '--no-compile-autoload-tsconfig',
        entry,
    ];

    // For GUI apps on Windows, you may want to hide the console window.
    // Sovereign can enable this by passing --windows-hide-console.
    if (process.platform === 'win32' && args['windows-hide-console'] === true) {
        compileArgs.splice(compileArgs.length - 1, 0, '--windows-hide-console');
    }

    process.stderr.write(`Building standalone executable: ${outfile}\n`);
    process.stderr.write(`Note: This builds for the current OS/arch (${os}/${arch}).\n`);

    const proc = Bun.spawn(['bun', ...compileArgs], { stdout: 'inherit', stderr: 'inherit' });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
        throw new Error(`bun build --compile failed with exit code ${exitCode}`);
    }
}

main().catch((err) => {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`${msg}\n`);
    process.exitCode = 1;
});
