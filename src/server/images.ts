import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import type { ImageOptions, UploadResult } from '../types.ts';
import type { EntryFile } from './entries.ts';

/**
 * Pasted and dropped images: saved into the configured folder under a clean file name, then the
 * site's `snippet` decides the MDX that goes in (a Markdown image, or an import line plus a component).
 */

const TYPES: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/avif': '.avif',
    'image/svg+xml': '.svg',
};

/** Stands in for the alt text when calling `snippet`, so the editor can select it afterwards. */
const ALT = '';

const RESERVED = new Set(
    'break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof let new null return static super switch this throw true try typeof var void while with yield await'.split(
        ' '
    )
);

export const imageExtension = (type: string): string | undefined => TYPES[type];

/** Names a clipboard gives a pasted screenshot, which say nothing about it. */
const generic = (base: string) => !base || /^(image|blob|unknown|untitled|pasted|clipboard)(-\d+)?$/.test(base);

/** A file name without spaces or capitals, and whether it was made up (so it gives no alt text). */
export function cleanName(name: string, ext: string, now = new Date()): { base: string; made: boolean } {
    const base = basename(name, extname(name))
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        .replace(/-+$/, '');
    if (!generic(base)) return { base: base + ext, made: false };
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
    return { base: `image-${stamp}${ext}`, made: true };
}

/** `how-many-times.jpg` → `howManyTimes`, not clashing with any identifier in the entry's imports. */
export function identFor(file: string, esm: string): string {
    const words = basename(file, extname(file))
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean);
    let ident = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('') || 'image';
    if (/^\d/.test(ident) || RESERVED.has(ident)) ident = `img${ident[0].toUpperCase()}${ident.slice(1)}`;
    const taken = new Set(esm.match(/[A-Za-z_$][\w$]*/g) ?? []);
    if (!taken.has(ident)) return ident;
    let n = 2;
    while (taken.has(`${ident}${n}`)) n++;
    return `${ident}${n}`;
}

/** The images folder for an entry, or null when it would land outside the project. */
export function imageDir(root: string, options: ImageOptions, entry: EntryFile): string | null {
    const template = options.dir ?? 'src/assets/{collection}/{id}';
    root = resolve(root); // no trailing separator
    const dir = resolve(root, template.replaceAll('{collection}', entry.collection).replaceAll('{id}', entry.id));
    return dir === root || dir.startsWith(root + sep) ? dir : null;
}

/**
 * Save `data` in `dir` as `name`, adding `-2`, `-3`… when a different file has that name. The same
 * image saved twice reuses the first file.
 */
async function saveUnique(dir: string, name: string, data: Buffer): Promise<string> {
    await mkdir(dir, { recursive: true });
    const ext = extname(name);
    const base = name.slice(0, -ext.length);
    for (let n = 1; ; n++) {
        const path = join(dir, n === 1 ? name : `${base}-${n}${ext}`);
        let existing: Buffer | null = null;
        try {
            existing = await readFile(path);
        } catch {
            // free
        }
        if (existing?.equals(data)) return path;
        if (existing) continue;
        try {
            await writeFile(path, data, { flag: 'wx' });
            return path;
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        }
    }
}

/** A relative import or link path, always starting with `.`, with `/` separators. */
function relativePath(from: string, to: string): string {
    const rel = relative(from, to).split(sep).join('/');
    return rel.startsWith('.') ? rel : `./${rel}`;
}

export interface Upload {
    name: string;
    type: string;
    data: Buffer;
    /** The entry's import lines as the editor has them (maybe unsaved), so identifiers don't clash. */
    esm: string;
}

export async function saveImage(
    root: string,
    options: ImageOptions,
    entry: EntryFile,
    upload: Upload,
    now = new Date()
): Promise<UploadResult> {
    const ext = imageExtension(upload.type);
    if (!ext) throw new Error(`not an image type the site can use: ${upload.type}`);
    const dir = imageDir(root, options, entry);
    if (!dir) throw new Error('images.dir is outside the project');
    const { base, made } = cleanName(upload.name, ext, now);
    const path = await saveUnique(dir, base, upload.data);
    const name = basename(path);
    const alt = made ? '' : base.slice(0, -ext.length).replace(/-/g, ' ');
    const info = {
        path: relativePath(dirname(entry.path), path),
        alt: ALT,
        name,
        ident: identFor(name, upload.esm),
        collection: entry.collection,
        id: entry.id,
    };
    const out = options.snippet ? options.snippet(info) : `![${ALT}](${info.path})`;
    const { markup, imports = [] } = typeof out === 'string' ? { markup: out } : out;
    const at = markup.indexOf(ALT);
    return {
        file: relative(root, path).split(sep).join('/'),
        markup: markup.replaceAll(ALT, alt),
        imports: imports.map((l) => l.replaceAll(ALT, alt)),
        alt: at < 0 ? null : [at, at + alt.length],
    };
}
