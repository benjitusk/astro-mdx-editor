import type { ClientConfig, CollectionSchema, Registry, UploadResult } from '../types.ts';

// Shared with src/server/api.ts; duplicated so the client bundle doesn't pull in Node modules.
export const API_BASE = '/__edit/api';
export const TOKEN_HEADER = 'x-mdx-editor-token';
export const BASE_HEADER = 'x-mdx-editor-base';
export const FILE_CHANGED_EVENT = 'mdx-editor:file-changed';

export interface FileResult {
    text: string;
    hash: string;
}

export function createApi(cfg: ClientConfig) {
    const query = `collection=${encodeURIComponent(cfg.collection)}&id=${encodeURIComponent(cfg.id)}`;
    const headers = { [TOKEN_HEADER]: cfg.token };
    return {
        async load(): Promise<FileResult> {
            const r = await fetch(`${API_BASE}/file?${query}`, { headers });
            if (!r.ok) throw new Error(`load failed: ${r.status}`);
            return r.json();
        },
        /** The element's MDX rendered by the site's pipeline (see src/server/render.ts). */
        async render(source: string, esm: string): Promise<{ html?: string; error?: string }> {
            const r = await fetch(`${API_BASE}/render`, {
                method: 'POST',
                headers: { ...headers, 'content-type': 'application/json' },
                body: JSON.stringify({ collection: cfg.collection, id: cfg.id, source, esm }),
            });
            if (!r.ok) throw new Error(`render failed: ${r.status}`);
            return r.json();
        },
        async schema(): Promise<CollectionSchema> {
            const r = await fetch(`${API_BASE}/schema?collection=${encodeURIComponent(cfg.collection)}`, { headers });
            if (!r.ok) throw new Error(`schema failed: ${r.status}`);
            return r.json();
        },
        async registry(): Promise<Registry> {
            const r = await fetch(`${API_BASE}/registry?${query}`, { headers });
            if (!r.ok) throw new Error(`registry failed: ${r.status}`);
            return r.json();
        },
        async entries(): Promise<{ collection: string; id: string }[]> {
            const r = await fetch(`${API_BASE}/entries`, { headers });
            if (!r.ok) throw new Error(`entries failed: ${r.status}`);
            return r.json();
        },
        /** The entry as committed at HEAD; null when it's new. */
        async diff(): Promise<{ head: string | null }> {
            const r = await fetch(`${API_BASE}/diff?${query}`, { headers });
            if (!r.ok) throw new Error(`diff failed: ${r.status}`);
            return r.json();
        },
        /** Commit the saved entry and the images it newly references. */
        async commit(message: string): Promise<{ commit: string; files: string[] }> {
            const r = await fetch(`${API_BASE}/commit`, {
                method: 'POST',
                headers: { ...headers, 'content-type': 'application/json' },
                body: JSON.stringify({ collection: cfg.collection, id: cfg.id, message }),
            });
            const body = await r.json().catch(() => null);
            if (!r.ok) throw new Error(body?.error ?? `commit failed: ${r.status}`);
            return body;
        },
        /** Save an image into the entry's images folder; `esm` is the entry's import lines, for naming. */
        async upload(file: Blob & { name?: string }, esm: string): Promise<UploadResult> {
            const r = await fetch(`${API_BASE}/upload`, {
                method: 'POST',
                headers: { ...headers, 'content-type': 'application/json' },
                body: JSON.stringify({
                    collection: cfg.collection,
                    id: cfg.id,
                    name: file.name ?? '',
                    type: file.type,
                    data: await base64(file),
                    esm,
                }),
            });
            if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `upload failed: ${r.status}`);
            return r.json();
        },
        /** Resolves to the new hash, or to the file's current contents when it changed underneath us. */
        async save(
            text: string,
            base: string
        ): Promise<{ ok: true; hash: string } | { ok: false; current: FileResult }> {
            const r = await fetch(`${API_BASE}/file?${query}`, {
                method: 'PUT',
                headers: { ...headers, [BASE_HEADER]: base, 'content-type': 'text/plain; charset=utf-8' },
                body: text,
            });
            if (r.status === 409) return { ok: false, current: await r.json() };
            if (!r.ok) throw new Error(`save failed: ${r.status}`);
            return { ok: true, hash: (await r.json()).hash };
        },
    };
}

export type Api = ReturnType<typeof createApi>;

function base64(blob: Blob): Promise<string> {
    return new Promise((ok, fail) => {
        const reader = new FileReader();
        reader.onload = () => {
            const url = reader.result as string;
            ok(url.slice(url.indexOf(',') + 1));
        };
        reader.onerror = () => fail(reader.error);
        reader.readAsDataURL(blob);
    });
}
