import type { EditorView } from '@codemirror/view';
import type { ClientConfig } from '../types.ts';
import type { Saver } from './save.ts';

// Shared with src/server/reload.ts.
const HELLO_EVENT = 'mdx-editor:hello';
const RELOAD_EVENT = 'mdx-editor:full-reload';
const KEY = 'mdx-editor:restore';

interface Snapshot {
    entry: string;
    anchor: number;
    head: number;
    scrollY: number;
}

/**
 * The server routes full-page reloads to editor tabs as a custom event (see src/server/reload.ts).
 * - Content reloads (only collection entries changed, e.g. every save) are ignored. The editor
 *   already hears about its own file through the file-changed event.
 * - Code reloads (a component or the Shell changed) reload the page once there are no unsaved edits,
 *   restoring the cursor and scroll position afterwards.
 */
export function handleReloads(view: EditorView, saver: Saver, cfg: ClientConfig) {
    const hot = import.meta.hot;
    if (!hot) return;
    const entry = `${cfg.collection}/${cfg.id}`;
    const hello = () => hot.send(HELLO_EVENT, {});
    hello();
    hot.on('vite:ws:connect', hello);

    let pending = false;
    const reload = () => {
        const { anchor, head } = view.state.selection.main;
        try {
            sessionStorage.setItem(KEY, JSON.stringify({ entry, anchor, head, scrollY } satisfies Snapshot));
        } catch {
            // private mode: reload without restoring
        }
        location.reload();
    };
    hot.on(RELOAD_EVENT, (data: { kind: 'content' | 'code' }) => {
        if (data.kind === 'content') return;
        if (saver.dirty) {
            pending = true;
            saver.onSaved(() => pending && reload());
        } else reload();
    });
}

/** After a code reload, put the cursor and scroll back where they were. */
export function restoreSnapshot(view: EditorView, cfg: ClientConfig) {
    let snap: Snapshot | null = null;
    try {
        snap = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
        sessionStorage.removeItem(KEY);
    } catch {
        return;
    }
    if (!snap || snap.entry !== `${cfg.collection}/${cfg.id}`) return;
    const len = view.state.doc.length;
    view.dispatch({ selection: { anchor: Math.min(snap.anchor, len), head: Math.min(snap.head, len) } });
    requestAnimationFrame(() => scrollTo(0, snap!.scrollY));
}
