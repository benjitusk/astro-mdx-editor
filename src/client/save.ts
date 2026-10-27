import { Annotation, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { ClientConfig } from '../types.ts';
import { FILE_CHANGED_EVENT, type Api, type FileResult } from './api.ts';
import { h } from './dom.ts';

/** Marks transactions that load text from disk, so they don't count as unsaved edits. */
export const fromDisk = Annotation.define<boolean>();

const AUTOSAVE_MS = 800;

type Status = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';

/** Replace only the span that differs, so the cursor and scroll survive a reload from disk. */
export function applyMinimalChange(view: EditorView, next: string) {
    const cur = view.state.doc.toString();
    if (cur === next) return;
    let a = 0;
    while (a < cur.length && a < next.length && cur[a] === next[a]) a++;
    let b = 0;
    while (b < cur.length - a && b < next.length - a && cur[cur.length - 1 - b] === next[next.length - 1 - b]) b++;
    view.dispatch({
        changes: { from: a, to: cur.length - b, insert: next.slice(a, next.length - b) },
        annotations: fromDisk.of(true),
    });
}

export class Saver {
    private baseHash: string;
    private savedText: string;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private inflight: Promise<void> | null = null;
    private statusEl = h('div', { class: 'mdx-editor-status', role: 'status' });
    private banner: HTMLElement | null = null;
    private api: Api;
    view!: EditorView;

    constructor(api: Api, cfg: ClientConfig, text: string) {
        this.api = api;
        this.baseHash = cfg.hash;
        this.savedText = text;
        document.body.append(this.statusEl);
        this.setStatus('saved');
        addEventListener('beforeunload', (e) => {
            if (this.dirty) e.preventDefault();
        });
        import.meta.hot?.on(FILE_CHANGED_EVENT, (data: { collection: string; id: string; hash: string }) => {
            if (data.collection === cfg.collection && data.id === cfg.id && data.hash !== this.baseHash) {
                void this.onDiskChange();
            }
        });
    }

    private savedListeners: (() => void)[] = [];

    /** Run once after the next successful save that leaves no unsaved edits. */
    onSaved(fn: () => void) {
        this.savedListeners.push(fn);
    }

    get dirty() {
        return this.view.state.doc.toString() !== this.savedText;
    }

    private setStatus(s: Status, detail = '') {
        const label = {
            saved: 'Saved',
            unsaved: 'Unsaved',
            saving: 'Saving…',
            error: 'Not saved',
            conflict: 'Conflict',
        }[s];
        this.statusEl.textContent = detail ? `${label} · ${detail}` : label;
        this.statusEl.dataset.status = s;
    }

    onUpdate(u: ViewUpdate) {
        if (!u.docChanged || u.transactions.every((t) => t.annotation(fromDisk))) return;
        if (this.banner) return; // a conflict is open; don't save over it
        this.setStatus('unsaved');
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.save(), AUTOSAVE_MS);
    }

    /** Save now (Cmd-S, or when the autosave timer fires). */
    async save(): Promise<void> {
        clearTimeout(this.timer);
        if (this.inflight) await this.inflight;
        if (this.banner || !this.dirty) {
            if (!this.banner) this.setStatus('saved');
            return;
        }
        const text = this.view.state.doc.toString();
        this.setStatus('saving');
        this.inflight = (async () => {
            try {
                const r = await this.api.save(text, this.baseHash);
                if (r.ok) {
                    this.baseHash = r.hash;
                    this.savedText = text;
                    this.setStatus(
                        this.dirty ? 'unsaved' : 'saved',
                        new Date().toLocaleTimeString([], { timeStyle: 'short' })
                    );
                    if (!this.dirty) this.savedListeners.splice(0).forEach((fn) => fn());
                } else {
                    this.showConflict(r.current);
                }
            } catch (e) {
                this.setStatus('error', 'will retry');
                this.timer = setTimeout(() => void this.save(), 5000);
            }
        })();
        await this.inflight;
        this.inflight = null;
    }

    private async onDiskChange() {
        if (this.inflight) await this.inflight;
        const current = await this.api.load();
        if (current.hash === this.baseHash) return; // our own save
        if (this.dirty) return this.showConflict(current);
        this.baseHash = current.hash;
        this.savedText = current.text;
        applyMinimalChange(this.view, current.text);
        this.setStatus('saved', 'reloaded from disk');
    }

    private showConflict(current: FileResult) {
        this.banner?.remove();
        this.setStatus('conflict');
        const close = () => {
            this.banner?.remove();
            this.banner = null;
        };
        this.banner = h(
            'div',
            { class: 'mdx-editor-banner', role: 'alert' },
            h('span', {}, 'This file changed on disk while you had unsaved edits.'),
            h(
                'button',
                {
                    onclick: () => {
                        // Overwrite: our text, saved against the version now on disk.
                        this.baseHash = current.hash;
                        close();
                        void this.save();
                    },
                },
                'Keep mine'
            ),
            h(
                'button',
                {
                    onclick: () => {
                        this.baseHash = current.hash;
                        this.savedText = current.text;
                        applyMinimalChange(this.view, current.text);
                        close();
                        this.setStatus('saved', 'loaded from disk');
                    },
                },
                'Load theirs'
            )
        );
        document.body.append(this.banner);
    }
}

export function saveExtension(saver: Saver): Extension {
    return ViewPlugin.define((view) => {
        saver.view = view;
        return { update: (u) => saver.onUpdate(u) };
    });
}
