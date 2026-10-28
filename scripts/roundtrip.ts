/**
 * Round-trip gate: every entry in the given sites must come out of the editor byte for byte.
 *
 *   npm run roundtrip -- <site> [<site>…]
 *
 * Each file is loaded with the editor's full state setup, the cursor is walked through it so every
 * live-preview state is built, and the text that would be saved is compared with the file.
 */
import { EditorState } from '@codemirror/state';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { stateExtensions } from '../src/client/editor.ts';

async function* entries(dir: string): AsyncGenerator<string> {
    for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
        if (e.isFile() && /\.mdx?$/.test(e.name)) yield join(e.parentPath, e.name);
    }
}

const sites = process.argv.slice(2);
if (!sites.length) {
    console.error('usage: npm run roundtrip -- <site> [<site>…]');
    process.exit(2);
}

let files = 0;
let failures = 0;
for (const site of sites) {
    const content = resolve(site, 'src/content');
    for await (const path of entries(content)) {
        files++;
        const text = await readFile(path, 'utf8');
        let state = EditorState.create({ doc: text, extensions: stateExtensions(text) });
        const steps = Math.min(200, state.doc.length);
        for (let i = 0; i <= steps; i++) {
            const pos = Math.round((i / Math.max(1, steps)) * state.doc.length);
            state = state.update({ selection: { anchor: pos } }).state;
        }
        const out = state.doc.toString();
        if (out !== text) {
            failures++;
            let at = 0;
            while (at < text.length && text[at] === out[at]) at++;
            console.error(`✗ ${relative(process.cwd(), path)}: differs at offset ${at}`);
        }
    }
}
console.log(`${files - failures}/${files} entries round-trip unchanged`);
process.exit(failures ? 1 : 0);
