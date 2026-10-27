import type { Plugin } from 'vite';
import type { ClientConfig, MdxEditorOptions, ResolvedCollection } from '../types.ts';

const SHELL = 'virtual:mdx-editor/shell';
const GLOBALS = 'virtual:mdx-editor/globals';
const SERVER = 'virtual:mdx-editor/server';

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
 * - `server`: the session token and an entry reader, for page frontmatter only.
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
            if (ids.has(id)) return '\0' + id;
        },
        load(id) {
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
export async function loadEntry(collection, id) {
    const file = await findEntry(collections, collection, id);
    return file ? { ...file, ...(await readEntry(file)) } : null;
}
export const entries = () => listEntries(collections);
export function pageUrl(collection, id) {
    return options?.collections?.[collection]?.pageUrl?.(id) ?? null;
}
`;
}
