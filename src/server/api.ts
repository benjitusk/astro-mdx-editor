import type { IncomingMessage, ServerResponse } from 'node:http';
import { sep } from 'node:path';
import type { ViteDevServer } from 'vite';
import type { ImageOptions, ResolvedCollection } from '../types.ts';
import type { EmojiTable } from './emoji.ts';
import { entryForPath, findEntry, listEntries, readEntry, writeEntry } from './entries.ts';
import { hashText } from './hash.ts';
import { commitEntry, headVersion } from './git.ts';
import { saveImage } from './images.ts';
import { createEntry, newEntryText } from './newentry.ts';
import type { createRegistry } from './registry.ts';
import type { createSchemas } from './schema.ts';
import type { createRenderer } from './render.ts';

export const API_BASE = '/__edit/api';
export const TOKEN_HEADER = 'x-mdx-editor-token';
export const BASE_HEADER = 'x-mdx-editor-base';
export const FILE_CHANGED_EVENT = 'mdx-editor:file-changed';

const MAX_BODY = 10 * 1024 * 1024;
// Uploads arrive as base64 in JSON: a 30 MB image.
const MAX_UPLOAD = 40 * 1024 * 1024;

interface Context {
    token: string;
    root: string;
    collections: ResolvedCollection[];
    /** A collection's `newEntry` template. */
    newEntry: (collection: string) => ((title: string) => Record<string, unknown>) | undefined;
    /** A collection's image settings, or null when paste and drop are off for it. */
    images: (collection: string) => ImageOptions | null;
    renderer: ReturnType<typeof createRenderer>;
    registry: ReturnType<typeof createRegistry>;
    schemas: ReturnType<typeof createSchemas>;
    /** The site's emoji shortcodes, or null when emoji are off or the site has no satteri-emoji. */
    emoji: () => Promise<EmojiTable | null>;
}

function send(res: ServerResponse, status: number, body: unknown) {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, limit = MAX_BODY): Promise<string> {
    return new Promise((ok, fail) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (c: Buffer) => {
            size += c.length;
            if (size > limit) {
                fail(new Error('body too large'));
                req.destroy();
            } else chunks.push(c);
        });
        req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
        req.on('error', fail);
    });
}

/**
 * Any page open in the browser can send requests to localhost, so every request needs the per-session
 * token (only served inside the editor page), and requests that carry an Origin must be same-origin.
 * Writes always carry one.
 */
function allowed(req: IncomingMessage, token: string): boolean {
    if (req.headers[TOKEN_HEADER] !== token) return false;
    const origin = req.headers.origin;
    const writes = req.method !== 'GET' && req.method !== 'HEAD';
    if (!origin) return !writes;
    try {
        return new URL(origin).host === req.headers.host;
    } catch {
        return false;
    }
}

/** Resolves when Astro next rewrites its content store (after a sync), or after `timeout` ms. */
function contentSynced(server: ViteDevServer, timeout: number): Promise<void> {
    return new Promise((done) => {
        const onChange = (path: string) => {
            if (!/[\\/]\.astro[\\/]data-store\.json$/.test(path)) return;
            finish();
        };
        const finish = () => {
            clearTimeout(timer);
            server.watcher.off('change', onChange);
            server.watcher.off('add', onChange);
            done();
        };
        const timer = setTimeout(finish, timeout);
        server.watcher.on('change', onChange);
        server.watcher.on('add', onChange);
    });
}

export function mountApi(server: ViteDevServer, ctx: Context) {
    server.middlewares.use(API_BASE, async (req, res) => {
        if (!allowed(req, ctx.token)) return send(res, 403, { error: 'forbidden' });
        const url = new URL(req.url ?? '/', 'http://localhost');
        try {
            if (url.pathname === '/entries' && req.method === 'GET') {
                const entries = await listEntries(ctx.collections);
                return send(
                    res,
                    200,
                    entries.map(({ collection, id }) => ({ collection, id }))
                );
            }
            if (url.pathname === '/emoji' && req.method === 'GET') {
                const table = await ctx.emoji();
                return table ? send(res, 200, table) : send(res, 404, { error: 'no emoji' });
            }
            if (url.pathname === '/schema' && req.method === 'GET') {
                const collection = url.searchParams.get('collection') ?? '';
                if (!ctx.collections.some((c) => c.name === collection))
                    return send(res, 404, { error: 'no such collection' });
                const schema = await ctx.schemas.schema(collection);
                return schema ? send(res, 200, schema) : send(res, 404, { error: 'no schema' });
            }
            if (url.pathname === '/registry' && req.method === 'GET') {
                const file = await findEntry(
                    ctx.collections,
                    url.searchParams.get('collection') ?? '',
                    url.searchParams.get('id') ?? ''
                );
                if (!file) return send(res, 404, { error: 'no such entry' });
                return send(res, 200, await ctx.registry.registry(ctx.collections, file));
            }
            if (url.pathname === '/render' && req.method === 'POST') {
                const body = JSON.parse(await readBody(req)) as {
                    collection: string;
                    id: string;
                    source: string;
                    esm?: string;
                };
                const file = await findEntry(ctx.collections, body.collection, body.id);
                if (!file || typeof body.source !== 'string') return send(res, 404, { error: 'no such entry' });
                const esm = typeof body.esm === 'string' ? body.esm : undefined;
                return send(res, 200, await ctx.renderer.render(file, body.source, esm));
            }
            if (url.pathname === '/new' && req.method === 'POST') {
                const body = JSON.parse(await readBody(req)) as { collection: string; title: string };
                const collection = ctx.collections.find((c) => c.name === body.collection);
                const title = typeof body.title === 'string' ? body.title.trim() : '';
                if (!collection || !title) return send(res, 400, { error: 'a collection and a title are needed' });
                const schema = await ctx.schemas.schema(collection.name).catch(() => null);
                const text = newEntryText(title, ctx.newEntry(collection.name), schema?.schema ?? null);
                // The editor page reads the entry from the content layer, so answer once it has synced.
                const synced = contentSynced(server, 4000);
                const id = await createEntry(collection, title, text);
                await synced;
                return send(res, 200, { collection: collection.name, id });
            }
            if (url.pathname === '/diff' && req.method === 'GET') {
                const file = await findEntry(
                    ctx.collections,
                    url.searchParams.get('collection') ?? '',
                    url.searchParams.get('id') ?? ''
                );
                if (!file) return send(res, 404, { error: 'no such entry' });
                return send(res, 200, { head: await headVersion(file.path) });
            }
            if (url.pathname === '/commit' && req.method === 'POST') {
                const body = JSON.parse(await readBody(req)) as { collection: string; id: string; message: string };
                const file = await findEntry(ctx.collections, body.collection, body.id);
                const message = typeof body.message === 'string' ? body.message.trim() : '';
                if (!file || !message) return send(res, 400, { error: 'an entry and a message are needed' });
                const { text } = await readEntry(file);
                return send(res, 200, await commitEntry(file.path, text, message));
            }
            if (url.pathname === '/upload' && req.method === 'POST') {
                const body = JSON.parse(await readBody(req, MAX_UPLOAD)) as {
                    collection: string;
                    id: string;
                    name: string;
                    type: string;
                    data: string;
                    esm?: string;
                };
                const file = await findEntry(ctx.collections, body.collection, body.id);
                const options = ctx.images(body.collection);
                if (!file || !options || typeof body.data !== 'string')
                    return send(res, 404, { error: 'no such entry, or images are off' });
                const upload = {
                    name: String(body.name ?? ''),
                    type: String(body.type ?? ''),
                    data: Buffer.from(body.data, 'base64'),
                    esm: typeof body.esm === 'string' ? body.esm : '',
                };
                return send(res, 200, await saveImage(ctx.root, options, file, upload));
            }
            if (url.pathname === '/file') {
                const file = await findEntry(
                    ctx.collections,
                    url.searchParams.get('collection') ?? '',
                    url.searchParams.get('id') ?? ''
                );
                if (!file) return send(res, 404, { error: 'no such entry' });
                if (req.method === 'GET') return send(res, 200, await readEntry(file));
                if (req.method === 'PUT') {
                    const text = await readBody(req);
                    const current = await readEntry(file);
                    // Refuse to overwrite changes made elsewhere since the client last loaded or saved.
                    if (current.hash !== req.headers[BASE_HEADER]) return send(res, 409, current);
                    return send(res, 200, { hash: await writeEntry(file, text) });
                }
            }
            send(res, 404, { error: 'not found' });
        } catch (e) {
            send(res, 500, { error: String(e) });
        }
    });

    // Tell open editors when one of their files changes on disk (another editor, git, an agent).
    const notify = async (path: string) => {
        const entry = entryForPath(ctx.collections, path);
        if (!entry) {
            if (!path.includes(`${sep}node_modules${sep}`) && !path.includes(`${sep}.astro${sep}`))
                ctx.renderer.invalidate();
            return;
        }
        try {
            const { hash } = await readEntry(entry);
            server.ws.send({
                type: 'custom',
                event: FILE_CHANGED_EVENT,
                data: { collection: entry.collection, id: entry.id, hash },
            });
        } catch {
            // deleted or unreadable; the editor will find out on its next save
        }
    };
    server.watcher.on('change', notify);
    server.watcher.on('add', notify);
}

export { hashText };
