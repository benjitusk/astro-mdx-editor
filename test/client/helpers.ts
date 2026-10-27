import { EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { stateExtensions } from '../../src/client/editor.ts';

/**
 * A view from a doc written with selection marks: `|` is a cursor, `[` … `]` a selection
 * (use `\[` / `\]` / `\|` for literal characters).
 */
export function view(marked: string, extra: Extension = []) {
    const ranges: { anchor: number; head: number }[] = [];
    let doc = '';
    let start = -1;
    for (let i = 0; i < marked.length; i++) {
        const c = marked[i];
        if (c === '\\' && '[]|'.includes(marked[i + 1])) {
            doc += marked[++i];
        } else if (c === '|') ranges.push({ anchor: doc.length, head: doc.length });
        else if (c === '[') start = doc.length;
        else if (c === ']' && start >= 0) {
            ranges.push({ anchor: start, head: doc.length });
            start = -1;
        } else doc += c;
    }
    const selection = ranges.length
        ? EditorSelection.create(ranges.map((r) => EditorSelection.range(r.anchor, r.head)))
        : undefined;
    return new EditorView({
        state: EditorState.create({ doc, selection, extensions: [stateExtensions(doc), extra ?? []] }),
        parent: document.body,
    });
}

/** The doc with the selection marked the same way. */
export function marked(v: EditorView): string {
    const doc = v.state.doc.toString();
    const marks: [number, string][] = [];
    for (const r of v.state.selection.ranges) {
        if (r.empty) marks.push([r.head, '|']);
        else marks.push([r.from, '['], [r.to, ']']);
    }
    marks.sort((a, b) => b[0] - a[0] || (a[1] === '[' ? -1 : 1));
    let out = doc;
    for (const [pos, m] of marks) out = out.slice(0, pos) + m + out.slice(pos);
    return out;
}
