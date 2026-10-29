import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import { unifiedMergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { ClientConfig } from '../types.ts';
import type { Api } from './api.ts';
import { h } from './dom.ts';
import type { Saver } from './save.ts';
import { scrollSync } from './scrollsync.ts';

/**
 * The writing workflow's side panes, one open at a time: the scratchpad (a note per entry, kept only in
 * this browser), changes since the last commit with a Commit button, and the published page live, scrolled
 * along with the editor.
 */

let open: { name: string; close: () => void } | null = null;

/** A pane on the right, closing whichever one was open. Returns null when this one was open (toggled off). */
function pane(name: string, title: string, wide: boolean, view: EditorView) {
    const was = open?.name;
    open?.close();
    if (was === name) {
        view.focus();
        return null;
    }
    const body = h('div', { class: 'mdx-pane-body' });
    const closeButton = h('button', { 'class': 'mdx-pane-close', 'aria-label': 'Close' }, '×');
    const el = h(
        'aside',
        { 'class': `mdx-pane${wide ? ' mdx-pane-wide' : ''}`, 'aria-label': title },
        h('header', {}, h('strong', {}, title), closeButton),
        body
    );
    // Inside the editor's Prose, so the scratchpad's preview gets the site's styles.
    (view.dom.closest('.mdx-editor') ?? document.body).append(el);
    document.documentElement.classList.add(wide ? 'mdx-pane-open-wide' : 'mdx-pane-open');
    const close = () => {
        el.remove();
        document.documentElement.classList.remove('mdx-pane-open', 'mdx-pane-open-wide');
        if (open?.name === name) open = null;
    };
    closeButton.addEventListener('click', () => {
        close();
        view.focus();
    });
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            close();
            view.focus();
        }
    });
    open = { name, close };
    return { el, body, close };
}

// ---------- scratchpad ----------

export const scratchKey = (cfg: Pick<ClientConfig, 'collection' | 'id'>) =>
    `mdx-editor:scratch:${cfg.collection}/${cfg.id}`;

function readScratch(key: string): string {
    try {
        return localStorage.getItem(key) ?? '';
    } catch {
        return '';
    }
}

function writeScratch(key: string, text: string) {
    try {
        if (text.trim()) localStorage.setItem(key, text);
        else localStorage.removeItem(key);
    } catch {
        // private mode or storage full: the note lives until the pane closes
    }
}

/** `stateExtensions` from the editor, passed in to avoid an import cycle. */
export function scratchpad(cfg: ClientConfig, preview: (text: string) => unknown) {
    return (view: EditorView): boolean => {
        const p = pane('scratch', 'Scratchpad', false, view);
        if (!p) return true;
        const key = scratchKey(cfg);
        const text = readScratch(key);
        let timer: ReturnType<typeof setTimeout> | undefined;
        p.body.append(
            h(
                'p',
                { class: 'mdx-pane-note' },
                'Notes for this entry, kept in this browser only. Never saved to the file.'
            )
        );
        const note = new EditorView({
            parent: p.body,
            state: EditorState.create({
                doc: text,
                extensions: [
                    preview(text) as never,
                    keymap.of([
                        // Cmd-J again (or Escape) goes back to the entry.
                        { key: 'Mod-j', run: () => (open?.close(), view.focus(), true) },
                        ...defaultKeymap,
                        ...historyKeymap,
                    ]),
                    EditorView.lineWrapping,
                    EditorView.contentAttributes.of({ 'spellcheck': 'true', 'aria-label': 'Scratchpad' }),
                    EditorView.updateListener.of((u) => {
                        if (!u.docChanged) return;
                        clearTimeout(timer);
                        timer = setTimeout(() => writeScratch(key, u.state.doc.toString()), 300);
                    }),
                ],
            }),
        });
        const close = p.close;
        open!.close = () => {
            clearTimeout(timer);
            writeScratch(key, note.state.doc.toString());
            note.destroy();
            close();
        };
        note.focus();
        return true;
    };
}

// ---------- changes and commit ----------

export function gitPane(api: Api, saver: Saver) {
    return (view: EditorView): boolean => {
        const p = pane('git', 'Changes since the last commit', true, view);
        if (!p) return true;
        const status = h('p', { class: 'mdx-pane-note' }, 'Loading…');
        const diff = h('div', { class: 'mdx-diff' });
        const message = h('textarea', {
            'class': 'mdx-commit-message',
            'rows': '2',
            'placeholder': 'Commit message',
            'aria-label': 'Commit message',
        });
        const button = h('button', { class: 'mdx-commit' }, 'Commit');
        const result = h('p', { class: 'mdx-pane-note', role: 'status' });
        p.body.append(status, diff, h('div', { class: 'mdx-commit-row' }, message, button), result);
        let shown: EditorView | null = null;

        const load = async () => {
            await saver.save();
            const { head } = await api.diff();
            const text = view.state.doc.toString();
            shown?.destroy();
            shown = null;
            const changed = head !== text;
            status.textContent =
                head === null
                    ? 'A new file: not committed yet.'
                    : changed
                      ? 'This entry against the last commit. Only it, and images it adds, are committed.'
                      : 'No changes since the last commit.';
            button.disabled = !changed;
            if (changed)
                shown = new EditorView({
                    parent: diff,
                    state: EditorState.create({
                        doc: text,
                        extensions: [
                            unifiedMergeView({
                                original: head ?? '',
                                mergeControls: false,
                                collapseUnchanged: { margin: 2 },
                            }),
                            EditorState.readOnly.of(true),
                            EditorView.editable.of(false),
                            EditorView.lineWrapping,
                        ],
                    }),
                });
        };

        button.addEventListener('click', async () => {
            const msg = message.value.trim();
            if (!msg) return message.focus();
            button.disabled = true;
            result.textContent = 'Committing…';
            try {
                await saver.save();
                if (saver.dirty) throw new Error('the entry has unsaved changes');
                const r = await api.commit(msg);
                result.textContent = `Committed ${r.commit}: ${r.files.join(', ')}. Not pushed.`;
                message.value = '';
                await load();
            } catch (e) {
                result.textContent = `Couldn't commit: ${e instanceof Error ? e.message : String(e)}`;
                button.disabled = false;
            }
        });
        message.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) button.click();
        });
        const close = p.close;
        open!.close = () => {
            shown?.destroy();
            close();
        };
        void load().catch(
            (e) => (status.textContent = `Couldn't load the diff: ${e instanceof Error ? e.message : e}`)
        );
        message.focus();
        return true;
    };
}

// ---------- live page ----------

export function livePage(cfg: ClientConfig) {
    return (view: EditorView): boolean => {
        if (!cfg.pageUrl) return false;
        const p = pane('live', 'Page', true, view);
        if (!p) return true;
        // The page reloads itself after each save (Astro's dev reload reaches it like any tab).
        const frame = h('iframe', { class: 'mdx-live', src: cfg.pageUrl, title: 'The published page' });
        p.body.append(frame);
        const stop = scrollSync(view, frame);
        const close = p.close;
        open!.close = () => {
            stop();
            close();
        };
        view.focus();
        return true;
    };
}
