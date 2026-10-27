import { readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';
import { listEntries } from './entries.ts';
import { importLines } from './render.ts';
import { DEFAULT_CALLOUT_TYPES } from '../defaults.ts';
import type { ClientConfig, MdxEditorOptions, ResolvedCollection } from '../types.ts';

const SHELL = 'virtual:mdx-editor/shell';
const GLOBALS = 'virtual:mdx-editor/globals';
const SERVER = 'virtual:mdx-editor/server';
const STYLES = 'virtual:mdx-editor/styles';

interface Context {
    options: MdxEditorOptions;
    token: string;
    shell: string;
    globals: string | null;
    collections: ResolvedCollection[];
    serverModule: string;
}

/**
 * Virtual modules for the injected editor pages:
 * - `shell`: the site's Shell component;
 * - `globals`: the site's globally available components (imported so their scoped CSS loads);
 * - `server`: the session token and an entry reader, for page frontmatter only;
 * - `styles`: imports every component the collections' entries import, so their CSS loads on the
 *   editor page as `globals` does (for sites whose entries import their components).
 */
export function editorVitePlugin(ctx: Context): Plugin {
    const ids = new Map([
        [SHELL, `export { default } from ${JSON.stringify(ctx.shell)};`],
        [GLOBALS, ctx.globals ? `export * from ${JSON.stringify(ctx.globals)};` : 'export {};'],
        [SERVER, serverModule(ctx)],
    ]);
    return {
        name: 'astro-mdx-editor',
        resolveId(id) {
            if (ids.has(id) || id === STYLES) return '\0' + id;
        },
        async load(id) {
            if (id === '\0' + STYLES) {
                const files = new Set<string>();
                for (const entry of await listEntries(ctx.collections)) {
                    const text = await readFile(entry.path, 'utf8').catch(() => '');
                    for (const stmt of importLines(text)) {
                        const spec = /\bfrom\s*(['"])([^'"]+)\1/.exec(stmt)?.[2];
                        const resolved = spec && (await this.resolve(spec, entry.path));
                        const file = resolved ? resolved.id.split('?')[0] : '';
                        if (/\.(astro|[jt]sx|vue|svelte)$/.test(file)) files.add(file);
                    }
                }
                return [...files].map((f) => `import ${JSON.stringify(f)};`).join('\n') || 'export {};';
            }
            if (id.startsWith('\0')) return ids.get(id.slice(1));
        },
    };
}

function serverModule(ctx: Context): string {
    const typography: ClientConfig['typography'] = {
        quotes: ctx.options.typography?.quotes ?? true,
        dashes: ctx.options.typography?.dashes ?? true,
        ellipsis: ctx.options.typography?.ellipsis ?? true,
    };
    // Options hold functions (pageUrl) that can't be serialised; Astro's dev module runner is
    // in-process, so the page reads them from the registry the integration set up.
    return `
import { findEntry, listEntries, readEntry } from ${JSON.stringify(ctx.serverModule)};
const collections = ${JSON.stringify(ctx.collections)};
const options = globalThis[Symbol.for('astro-mdx-editor')]?.options;
export const token = ${JSON.stringify(ctx.token)};
export const typography = ${JSON.stringify(typography)};
export const keymap = ${JSON.stringify(ctx.options.keymap ?? {})};
export const callouts = ${JSON.stringify(ctx.options.callouts ?? DEFAULT_CALLOUT_TYPES)};
export const emoji = ${JSON.stringify(ctx.options.emoji !== false)};
export async function loadEntry(collection, id) {
    const file = await findEntry(collections, collection, id);
    if (!file) return null;
    // Vite serves any allowed file at /@fs/<absolute path>; relative image paths resolve against this.
    const posix = file.path.replace(/\\\\/g, '/');
    const fileBase = '/@fs' + (posix.startsWith('/') ? '' : '/') + posix.slice(0, posix.lastIndexOf('/') + 1);
    return { ...file, ...(await readEntry(file)), fileBase };
}
export const entries = () => listEntries(collections);
export function imagesOn(collection) {
    const own = options?.collections?.[collection]?.images;
    return (own ?? options?.images) !== false;
}
export function pageUrl(collection, id) {
    return options?.collections?.[collection]?.pageUrl?.(id) ?? null;
}
`;
}
