import { appendFileSync } from 'node:fs';
import type { HotPayload, ViteDevServer, WebSocketClient } from 'vite';

export const HELLO_EVENT = 'mdx-editor:hello';
export const RELOAD_EVENT = 'mdx-editor:full-reload';

/** Changes this close together count as one burst (a save, a git checkout). */
const BURST_MS = 2000;

const debug = (...args: unknown[]) => {
    if (process.env.MDX_EDITOR_DEBUG) appendFileSync(process.env.MDX_EDITOR_DEBUG, JSON.stringify(args) + '\n');
};

/**
 * Saving an entry makes Astro send full-page reloads to every browser: one from the content store
 * and one from its HMR plugin, since the `.mdx` is also an SSR module. Either would reload the editor
 * on every autosave and lose the cursor.
 *
 * Editor pages announce themselves over the HMR socket. Full reloads still reach every other page as
 * usual (a live preview of the page should reload), but editor pages get a custom event with a `kind`:
 * - `content` when every file changed in the latest burst is a collection entry;
 * - `code` otherwise.
 * The client ignores `content` reloads and handles `code` ones (src/client/reload.ts).
 */
export function routeFullReloads(server: ViteDevServer, isEntryFile: (path: string) => boolean) {
    const editors = new WeakSet<WebSocketClient>();
    server.ws.on(HELLO_EVENT, (_data: unknown, client: WebSocketClient) => {
        editors.add(client);
        debug('hello', server.ws.clients.size);
    });

    const recent = new Map<string, number>();
    const track = (path: string) => recent.set(path, Date.now());
    server.watcher.on('change', track);
    server.watcher.on('add', track);
    server.watcher.on('unlink', track);
    const kind = (): 'content' | 'code' => {
        const now = Date.now();
        for (const [path, t] of recent) if (now - t > BURST_MS) recent.delete(path);
        return recent.size > 0 && [...recent.keys()].every(isEntryFile) ? 'content' : 'code';
    };

    const patched = new WeakSet<object>();
    const wrap = (channel: { send: (...args: any[]) => void } | undefined) => {
        if (!channel || patched.has(channel)) return;
        patched.add(channel);
        const send = channel.send.bind(channel);
        channel.send = (...args: any[]) => {
            const payload = args[0] as HotPayload | string;
            const clients = [...server.ws.clients];
            if (typeof payload !== 'object' || payload.type !== 'full-reload' || !clients.some((c) => editors.has(c))) {
                return send(...args);
            }
            const k = kind();
            debug('full-reload', k, [...recent.keys()]);
            for (const client of clients) {
                if (editors.has(client)) client.send(RELOAD_EVENT, { kind: k });
                else client.send(payload);
            }
        };
    };
    wrap(server.ws);
    wrap(server.environments?.client?.hot);
}
