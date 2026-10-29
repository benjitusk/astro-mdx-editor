import type { ViteDevServer, WebSocketClient } from 'vite';
import type { EntryFile } from './entries.ts';

export const PAGE_QUERY = 'mdx-editor:page-entries';
export const PAGE_ANSWER = 'mdx-editor:page-entries-answer';

export interface PageEntry {
    collection: string;
    id: string;
}

/** A page path without its trailing slash, `index.html` or `.html`, and with `%xx` decoded. */
function normalise(path: string): string {
    let p = path.split(/[?#]/)[0];
    try {
        p = decodeURI(p);
    } catch {
        // keep it as sent
    }
    return p.replace(/\/index\.html$|\.html$/, '').replace(/\/+$/, '') || '/';
}

/**
 * The entries a page in the site shows, for the toolbar's "Edit this page". An entry whose `pageUrl` is
 * this page wins. Otherwise the page path must end with an entry's id (`/blog/first-post/` for
 * `blog/first-post`), since routes like `[...slug]` are usually built from it; when several match, the
 * ones whose collection name is also in the path come first. Several entries come back only when they
 * can't be told apart. The editor's own pages show none.
 */
export function entriesForPage(
    path: string,
    entries: PageEntry[],
    pageUrl: (collection: string, id: string) => string | null
): PageEntry[] {
    const page = normalise(path);
    if (page === '/' || page === '/__edit' || page.startsWith('/__edit/')) return [];
    const exact = entries.filter((e) => {
        const url = pageUrl(e.collection, e.id);
        return url !== null && normalise(url) === page;
    });
    if (exact.length) return exact;

    const segments = page.split('/').filter(Boolean);
    const suffix = entries.filter((e) => page.endsWith('/' + e.id));
    const named = suffix.filter((e) => segments.slice(0, -e.id.split('/').length).includes(e.collection));
    return named.length ? named : suffix;
}

/**
 * Answers the toolbar app's question over the HMR socket, to the tab that asked only. The answer
 * carries the path, so a tab that has navigated since ignores an old one.
 */
export function answerPageQueries(
    server: ViteDevServer,
    entries: () => Promise<EntryFile[]>,
    pageUrl: (collection: string, id: string) => string | null
) {
    server.ws.on(PAGE_QUERY, async (data: { path?: unknown }, client: WebSocketClient) => {
        if (typeof data?.path !== 'string') return;
        const all = (await entries()).map(({ collection, id }) => ({ collection, id }));
        client.send(PAGE_ANSWER, { path: data.path, entries: entriesForPage(data.path, all, pageUrl) });
    });
}
