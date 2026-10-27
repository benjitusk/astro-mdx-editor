import { syntaxTree } from '@codemirror/language';
import { EditorSelection, type ChangeSpec, type EditorState, type SelectionRange } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

/** Inline formats, by the Lezer node each produces. The markers match the essays' existing style. */
export const INLINE_FORMATS = {
    bold: { marker: '**', node: 'StrongEmphasis' },
    italic: { marker: '_', node: 'Emphasis' },
    code: { marker: '`', node: 'InlineCode' },
    strike: { marker: '~~', node: 'Strikethrough' },
} as const;
export type InlineFormat = keyof typeof INLINE_FORMATS;

function enclosing(state: EditorState, pos: number, name: string): SyntaxNode | null {
    for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
        if (n.name === name) return n;
    }
    for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
        if (n.name === name) return n;
    }
    return null;
}

/**
 * Bold, italic, code or strikethrough on every selection range:
 * - inside an existing span of that format: remove its markers;
 * - already wrapped (markers just outside or just inside the selection): unwrap;
 * - otherwise wrap, or with an empty selection insert a pair and put the cursor between.
 */
export function toggleInline(format: InlineFormat) {
    const { marker, node } = INLINE_FORMATS[format];
    const m = marker.length;
    return (view: EditorView): boolean => {
        const { state } = view;
        const tr = state.changeByRange((range) => {
            const doc = state.doc;
            const before = doc.sliceString(range.from - m, range.from);
            const after = doc.sliceString(range.to, range.to + m);
            if (!range.empty && before === marker && after === marker) {
                return {
                    changes: [
                        { from: range.from - m, to: range.from },
                        { from: range.to, to: range.to + m },
                    ],
                    range: EditorSelection.range(range.from - m, range.to - m),
                };
            }
            const text = doc.sliceString(range.from, range.to);
            if (text.length >= 2 * m && text.startsWith(marker) && text.endsWith(marker)) {
                return {
                    changes: { from: range.from, to: range.to, insert: text.slice(m, -m) },
                    range: EditorSelection.range(range.from, range.to - 2 * m),
                };
            }
            const span = range.empty ? enclosing(state, range.head, node) : null;
            if (span) {
                return {
                    changes: [
                        { from: span.from, to: span.from + m },
                        { from: span.to - m, to: span.to },
                    ],
                    range: EditorSelection.cursor(range.head - m),
                };
            }
            return {
                changes: [
                    { from: range.from, insert: marker },
                    { from: range.to, insert: marker },
                ],
                range: EditorSelection.range(range.from + m, range.to + m),
            };
        });
        view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }));
        return true;
    };
}

const URL_RE = /^(https?:\/\/|mailto:)\S+$/;

/** Cmd-K: `[text](|)`, or `[|](url)` when the selection is a URL, or `[|]()` with nothing selected. */
export function insertLink(view: EditorView): boolean {
    const { state } = view;
    const tr = state.changeByRange((range) => {
        const text = state.sliceDoc(range.from, range.to);
        if (URL_RE.test(text.trim())) {
            return {
                changes: { from: range.from, to: range.to, insert: `[](${text.trim()})` },
                range: EditorSelection.cursor(range.from + 1),
            };
        }
        const insert = `[${text}]()`;
        return {
            changes: { from: range.from, to: range.to, insert },
            range: EditorSelection.cursor(range.from + insert.length - 1 - (text ? 0 : 2)),
        };
    });
    view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }));
    return true;
}

/** The distinct lines touched by the selection. */
function selectedLines(state: EditorState) {
    const seen = new Set<number>();
    const lines = [];
    for (const r of state.selection.ranges) {
        for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
            if (!seen.has(n)) {
                seen.add(n);
                lines.push(state.doc.line(n));
            }
        }
    }
    return lines;
}

/** Rewrite each selected line's block prefix (heading marks, list markers, quote marks). */
function setLinePrefixes(
    view: EditorView,
    prefixFor: (text: string, index: number, allMatch: boolean) => string,
    matches: (text: string) => boolean,
    strip: RegExp
) {
    const { state } = view;
    const lines = selectedLines(state).filter((l) => l.text.trim() !== '');
    if (!lines.length) return true;
    const allMatch = lines.every((l) => matches(l.text));
    const changes: ChangeSpec[] = lines.map((l, i) => {
        const existing = strip.exec(l.text)?.[0] ?? '';
        return { from: l.from, to: l.from + existing.length, insert: prefixFor(l.text, i, allMatch) };
    });
    view.dispatch({ changes, userEvent: 'input.format', scrollIntoView: true });
    return true;
}

const BLOCK_PREFIX = /^(#{1,6} |> ?|\s*(?:[-*+]|\d+[.)]) )/;

/** Cmd-Alt-1…3 heading level, Cmd-Alt-0 paragraph. Pressing a line's own level again makes it a paragraph. */
export function setHeading(level: number) {
    return (view: EditorView) =>
        setLinePrefixes(
            view,
            (_text, _i, allMatch) => (level === 0 || allMatch ? '' : '#'.repeat(level) + ' '),
            (text) => level > 0 && text.startsWith('#'.repeat(level) + ' '),
            BLOCK_PREFIX
        );
}

/** Cmd-Shift-7 numbered list, Cmd-Shift-8 bullets: toggle on the selected lines. */
export function toggleList(ordered: boolean) {
    const re = ordered ? /^\s*\d+[.)] / : /^\s*[-*+] /;
    return (view: EditorView) =>
        setLinePrefixes(
            view,
            (_t, i, allMatch) => (allMatch ? '' : ordered ? `${i + 1}. ` : '- '),
            (t) => re.test(t),
            BLOCK_PREFIX
        );
}

/** Cmd-Shift-. blockquote: toggle `> ` on the selected lines. */
export function toggleQuote(view: EditorView) {
    return setLinePrefixes(
        view,
        (_t, _i, allMatch) => (allMatch ? '' : '> '),
        (t) => t.startsWith('>'),
        /^> ?/
    );
}

/** Cmd-/: wrap the selection (or the current line) in an MDX comment, or unwrap it. */
export function toggleComment(view: EditorView): boolean {
    const { state } = view;
    const open = '{/* ';
    const close = ' */}';
    const tr = state.changeByRange((range: SelectionRange) => {
        let from = range.from;
        let to = range.to;
        if (range.empty) {
            const l = state.doc.lineAt(range.head);
            from = l.from;
            to = l.to;
        }
        const text = state.sliceDoc(from, to);
        const m = /^\{\/\*\s?([\s\S]*?)\s?\*\/\}$/.exec(text);
        if (m) {
            return { changes: { from, to, insert: m[1] }, range: EditorSelection.range(from, from + m[1].length) };
        }
        return {
            changes: { from, to, insert: open + text + close },
            range: EditorSelection.range(from + open.length, to + open.length),
        };
    });
    view.dispatch(state.update(tr, { userEvent: 'input.format' }));
    return true;
}

/** Tab / Shift-Tab: indent list items by one level; elsewhere do nothing (keep focus in the editor). */
export function indentListItem(dir: 1 | -1) {
    return (view: EditorView): boolean => {
        const { state } = view;
        const lines = selectedLines(state).filter((l) => /^\s*(?:[-*+]|\d+[.)]) /.test(l.text));
        if (!lines.length) return true;
        const unit = '    ';
        const changes: ChangeSpec[] = [];
        for (const l of lines) {
            if (dir > 0) changes.push({ from: l.from, insert: unit });
            else {
                const lead = /^ {1,4}|^\t/.exec(l.text)?.[0];
                if (lead) changes.push({ from: l.from, to: l.from + lead.length });
            }
        }
        if (changes.length) view.dispatch({ changes, userEvent: dir > 0 ? 'input.indent' : 'delete.dedent' });
        return true;
    };
}
