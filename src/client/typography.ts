import { syntaxTree } from '@codemirror/language';
import { isolateHistory } from '@codemirror/commands';
import { EditorSelection, Transaction, type EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ClientConfig } from '../types.ts';
import { INLINE_FORMATS } from './formatting.ts';
import { inMeta, metaField } from './meta.ts';

const CODE_LIKE = new Set([
    'InlineCode',
    'CodeText',
    'FencedCode',
    'CodeBlock',
    'HTMLBlock',
    'HTMLTag',
    'Comment',
    'CommentBlock',
    'URL',
    'Autolink',
]);

/** True where typed punctuation is prose: not in code, JSX, an `{expression}`, a URL or frontmatter. */
export function isProseAt(state: EditorState, pos: number): boolean {
    if (inMeta(state.field(metaField), pos)) return false;
    for (let n = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent!) {
        if (CODE_LIKE.has(n.name)) return false;
        if (!n.parent) break;
    }
    const line = state.doc.lineAt(pos);
    const before = line.text.slice(0, pos - line.from);
    // Inside a JSX tag: `<Define word='…` — straight quotes there are syntax.
    const lt = before.lastIndexOf('<');
    if (lt > before.lastIndexOf('>') && /^<\/?[A-Za-z]/.test(before.slice(lt))) return false;
    // Inside an MDX expression `{…}`.
    if ((before.match(/\{/g)?.length ?? 0) > (before.match(/\}/g)?.length ?? 0)) return false;
    return true;
}

const OPENS_AFTER = /[\s([{—–\-“‘"']/;

/**
 * Smart typography while typing: “ ” ‘ ’, -- → —, ... → …. The plain character goes in first and the
 * replacement is a separate undo step, so Cmd-Z right after gets the plain character back.
 */
export function typography(opts: ClientConfig['typography']): Extension {
    return EditorView.inputHandler.of((view, from, to, text) => {
        if (view.composing || from !== to || text.length !== 1 || view.state.selection.ranges.length > 1) return false;
        const { state } = view;
        if (!isProseAt(state, from)) return false;
        const prev = state.sliceDoc(Math.max(0, from - 2), from);
        let replace: { from: number; insert: string } | null = null;
        if (opts.quotes && (text === '"' || text === "'")) {
            const p = prev.slice(-1);
            const opening = from === state.doc.lineAt(from).from || OPENS_AFTER.test(p);
            replace = { from, insert: text === '"' ? (opening ? '“' : '”') : opening ? '‘' : '’' };
        } else if (opts.dashes && text === '-' && prev.endsWith('-') && !prev.endsWith('--')) {
            // Not at a line start: `---` is a rule, `- ` a list item.
            const lineStart = state.doc.lineAt(from).from;
            if (/^\s*-?$/.test(state.sliceDoc(lineStart, from - 1))) return false;
            replace = { from: from - 1, insert: '—' };
        } else if (opts.ellipsis && text === '.' && prev === '..') {
            replace = { from: from - 2, insert: '…' };
        }
        if (!replace) return false;
        view.dispatch({ changes: { from, insert: text }, selection: { anchor: from + 1 }, userEvent: 'input.type' });
        view.dispatch({
            changes: { from: replace.from, to: from + 1, insert: replace.insert },
            selection: { anchor: replace.from + replace.insert.length },
            annotations: [isolateHistory.of('before'), Transaction.userEvent.of('input.type.smart')],
        });
        return true;
    });
}

const WRAP_MARKERS: Record<string, string> = {
    '*': INLINE_FORMATS.bold.marker,
    '_': INLINE_FORMATS.italic.marker,
    '`': INLINE_FORMATS.code.marker,
};

/** Typing `*`, `_` or `` ` `` with text selected wraps the selection (`*` makes it bold). */
export const wrapOnType: Extension = EditorView.inputHandler.of((view, _from, _to, text) => {
    const marker = WRAP_MARKERS[text];
    if (!marker || view.state.selection.ranges.every((r) => r.empty)) return false;
    view.dispatch(
        view.state.changeByRange((r) =>
            r.empty
                ? { changes: { from: r.from, insert: text }, range: EditorSelection.cursor(r.from + 1) }
                : {
                      changes: [
                          { from: r.from, insert: marker },
                          { from: r.to, insert: marker },
                      ],
                      range: EditorSelection.range(r.from + marker.length, r.to + marker.length),
                  }
        ),
        { userEvent: 'input.format' }
    );
    return true;
});
