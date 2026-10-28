/**
 * Builds the published package into dist/: tsc emits the JavaScript and declarations
 * (tsconfig.build.json), then this copies the files tsc doesn't touch (pages, CSS).
 *
 * Installed packages can't ship TypeScript: Astro loads the integration through the Vite server it
 * uses for the config, inlining `.ts` from node_modules, and that server closes once the config is
 * loaded, taking the integration's lazy imports with it.
 *
 *   node scripts/build.ts
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
execFileSync(join(root, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });

/** Relative `.ts` imports in a copied file, which must now name the emitted `.js`. */
const TS_IMPORT = /(import\s+'\.{1,2}\/[^']+)\.ts'/g;

function copyAssets(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const from = join(dir, entry.name);
        if (entry.isDirectory()) {
            copyAssets(from);
            continue;
        }
        if (extname(entry.name) === '.ts') continue;
        const to = join(dist, from.slice(src.length + 1));
        mkdirSync(dirname(to), { recursive: true });
        if (extname(entry.name) === '.astro') {
            const text = readFileSync(from, 'utf8');
            const out = text.replace(TS_IMPORT, "$1.js'");
            const left = out.match(/from\s+'\.{1,2}\/[^']+\.ts'|import\s+'\.{1,2}\/[^']+\.ts'/);
            if (left) throw new Error(`${from}: relative .ts import not rewritten: ${left[0]}`);
            writeFileSync(to, out);
        } else cpSync(from, to);
    }
}
copyAssets(src);

// Every page that imports client code must have been rewritten to the emitted file.
const edit = readFileSync(join(dist, 'pages', 'edit.astro'), 'utf8');
if (!edit.includes("import '../client/main.js'")) throw new Error('dist/pages/edit.astro: client import not rewritten');
console.log('Built dist/');
