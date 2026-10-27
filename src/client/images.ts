import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { dropCursor, EditorView } from '@codemirror/view';
import type { UploadResult } from '../types.ts';
import type { Api } from './api.ts';
import { h } from './dom.ts';
import { jsxField, type JsxElement } from './jsx.ts';
import { metaField } from './meta.ts';
import { markImported } from './registry.ts';
import { importChange, insertBlock } from './slash.ts';

/**
 * Pasting or dropping image files saves them through `POST /upload` (into the site's images folder) and
 * inserts the MDX the site's `images.snippet` returns, as a block of its own with any import lines it
 * needs. The alt text is selected afterwards, ready to type over.
 */

/** Where uploads in flight will insert, mapped through edits made while they upload. */
const addPending = StateEffect.define<{ id: number; pos: number }>();
const endPending = StateEffect.define<number>();
const pending = StateField.define<ReadonlyMap<number, number>>({
    create: () => new Map(),
    update(value, tr) {
        let next = value;
        if (tr.docChanged && value.size) next = new Map([...value].map(([k, p]) => [k, tr.changes.mapPos(p)]));
        for (const e of tr.effects) {
            if (e.is(addPending)) next = new Map(next).set(e.value.id, e.value.pos);
            else if (e.is(endPending)) {
                const copy = new Map(next);
                copy.delete(e.value);
                next = copy;
            }
        }
        return next;
    },
});

const imageFiles = (data: DataTransfer | null): File[] =>
    [...(data?.files ?? [])].filter((f) => f.type.startsWith('image/'));

export const esmText = (state: EditorState) =>
    state
        .field(metaField)
        .esm.map((s) => state.sliceDoc(s.from, s.to))
        .join('\n');

/** An import line, ignoring quote style, spacing and the semicolon, for spotting ones already there. */
const importKey = (line: string) => line.trim().replace(/;$/, '').replace(/"/g, "'").replace(/\s+/g, ' ');

/** The default import's name (`import Figure from …` → Figure), to tell the registry it's imported now. */
const defaultImport = (line: string) => /^\s*import\s+([A-Za-z_$][\w$]*)\s*(?:,|\s+from\b)/.exec(line)?.[1];

/**
 * Where an image dropped or pasted at `pos` goes: never inside a tag, the frontmatter or the imports.
 * Inside a tag it goes after the whole element.
 */
export function placeAt(state: EditorState, pos: number): number {
    const meta = state.field(metaField);
    const spans = [...(meta.frontmatter ? [meta.frontmatter] : []), ...meta.esm];
    if (spans.some((s) => pos >= s.from && pos <= s.to)) pos = Math.max(...spans.map((s) => s.to));
    const inTag = (els: readonly JsxElement[]): JsxElement | undefined => {
        for (const el of els) {
            if (pos < el.from || pos > el.to) continue;
            if (pos <= el.openTo || pos >= el.closeFrom) return el;
            const inner = inTag(el.children);
            if (inner) return inner;
        }
        return undefined;
    };
    const el = inTag(state.field(jsxField, false) ?? []);
    return el ? el.to : pos;
}

const blank = (state: EditorState, n: number) => n < 1 || n > state.doc.lines || !state.doc.line(n).text.trim();

/** Insert the snippets for saved images at `pos`: on a blank line there, else as a block after its line. */
export function insertImages(view: EditorView, pos: number, results: UploadResult[], userEvent = 'input.paste') {
    const { state } = view;
    const have = new Set(esmText(state).split('\n').map(importKey));
    const imports = [...new Set(results.flatMap((r) => r.imports))].filter((l) => !have.has(importKey(l)));
    const extra = imports.length ? [importChange(state, imports.join('\n'))] : [];
    const effects = imports.flatMap((l) => {
        const name = defaultImport(l);
        return name ? [markImported.of(name)] : [];
    });

    const line = state.doc.lineAt(pos);
    const indent = /^[ \t]*/.exec(line.text)![0];
    const text = results
        .map((r) => r.markup)
        .join('\n\n')
        .split('\n')
        .map((l, i) => (i && l ? indent + l : l))
        .join('\n');
    // The first image's alt text, shifted by the indent added to the lines above it.
    const alt = results[0].alt;
    const shift = alt ? indent.length * (results[0].markup.slice(0, alt[0]).split('\n').length - 1) : 0;
    const [anchor, head] = alt ? [alt[0] + shift, alt[1] + shift] : [text.length, text.length];

    if (!line.text.trim()) {
        insertBlock(view, line.from + indent.length, line.to, text, {
            cursor: anchor,
            head,
            extra,
            effects,
            userEvent,
        });
        return;
    }
    // After this line, with a blank line on each side.
    const after = blank(state, line.number + 1) ? '' : '\n';
    const insert = `\n\n${indent}${text}${after}`;
    const changes = state.changes([...extra, { from: line.to, insert }]);
    // An import line can go in at the same spot (an image right after the imports); ours comes last.
    const start = changes.mapPos(line.to, 1) - insert.length + 2 + indent.length;
    view.dispatch({
        changes,
        selection: { anchor: start + anchor, head: start + head },
        effects,
        scrollIntoView: true,
        userEvent,
    });
}

let seq = 0;

async function upload(view: EditorView, api: Api, files: File[], pos: number, userEvent: string) {
    const id = ++seq;
    view.dispatch({ effects: addPending.of({ id, pos: placeAt(view.state, pos) }) });
    try {
        // One at a time, so each image's import name sees the ones before it.
        const results: UploadResult[] = [];
        let esm = esmText(view.state);
        for (const f of files) {
            const r = await api.upload(f, esm);
            results.push(r);
            esm += `\n${r.imports.join('\n')}`;
        }
        const at = view.state.field(pending).get(id);
        if (at !== undefined) insertImages(view, placeAt(view.state, at), results, userEvent);
    } catch (e) {
        toast(`Couldn't save the image: ${(e instanceof Error ? e.message : String(e)).replace(/^Error: /, '')}`);
    } finally {
        view.dispatch({ effects: endPending.of(id) });
    }
}

function toast(message: string) {
    const el = h('div', { class: 'mdx-editor-toast', role: 'alert' }, message);
    document.body.append(el);
    setTimeout(() => el.remove(), 6000);
}

export function imageDrop(api: Api): Extension {
    return [
        pending,
        dropCursor(),
        EditorView.domEventHandlers({
            paste(e, view) {
                const files = imageFiles(e.clipboardData);
                if (!files.length) return false;
                e.preventDefault();
                void upload(view, api, files, view.state.selection.main.head, 'input.paste');
                return true;
            },
            dragover(e) {
                // Say "copy" for image files, so the browser doesn't open the image instead.
                if (e.dataTransfer?.types.includes('Files')) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                }
                return false;
            },
            drop(e, view) {
                const files = imageFiles(e.dataTransfer);
                if (!files.length) return false;
                e.preventDefault();
                const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
                void upload(view, api, files, pos, 'input.drop');
                return true;
            },
        }),
    ];
}
