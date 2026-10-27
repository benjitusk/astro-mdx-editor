import type { ClientConfig } from '../types.ts';

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
