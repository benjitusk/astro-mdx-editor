import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import type { ResolvedCollection } from '../types.ts';
import { hashText } from './hash.ts';

const EXTENSIONS = ['.mdx', '.md'];

export interface EntryFile {
    collection: string;
    id: string;
    path: string;
}

export function resolveCollections(root: string, collections: Record<string, { dir?: string }>): ResolvedCollection[] {
    return Object.entries(collections).map(([name, c]) => ({
        name,
        dir: resolve(root, c.dir ?? join('src', 'content', name)),
    }));
}

/** The file for `collection/id`, or null. Refuses ids that would escape the collection folder. */
export async function findEntry(
    collections: ResolvedCollection[],
    collection: string,
    id: string
): Promise<EntryFile | null> {
    const c = collections.find((x) => x.name === collection);
    if (!c || !id || id.includes('\0')) return null;
    for (const ext of EXTENSIONS) {
        const path = resolve(c.dir, id + ext);
        if (!path.startsWith(c.dir + sep)) return null;
        try {
            if ((await stat(path)).isFile()) return { collection, id, path };
        } catch {
            // try the next extension
        }
    }
    return null;
}

/** The entry a changed file belongs to, if it is in a collection. */
export function entryForPath(collections: ResolvedCollection[], path: string): EntryFile | null {
    const ext = extname(path);
    if (!EXTENSIONS.includes(ext)) return null;
    for (const c of collections) {
        if (path.startsWith(c.dir + sep)) {
            const id = relative(c.dir, path).slice(0, -ext.length).split(sep).join('/');
            return { collection: c.name, id, path };
        }
    }
    return null;
}

export async function listEntries(collections: ResolvedCollection[]): Promise<EntryFile[]> {
    const out: EntryFile[] = [];
    for (const c of collections) {
        let files: string[] = [];
        try {
            files = await readdir(c.dir, { recursive: true });
        } catch {
            continue;
        }
        for (const f of files.sort()) {
            const e = entryForPath(collections, join(c.dir, f));
            if (e) out.push(e);
        }
    }
    return out;
}

export async function readEntry(file: EntryFile) {
    const text = await readFile(file.path, 'utf8');
    return { text, hash: hashText(text) };
}

export async function writeEntry(file: EntryFile, text: string) {
    await writeFile(file.path, text, 'utf8');
    return hashText(text);
}
