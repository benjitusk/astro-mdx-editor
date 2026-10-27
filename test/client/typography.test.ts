import { undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { isProseAt, typography, wrapOnType } from '../../src/client/typography.ts';
import { marked, view } from './helpers.ts';

const on = { quotes: true, dashes: true, ellipsis: true };

/** Type characters one at a time through the input handlers, as the browser would. */
function type(v: EditorView, text: string) {
    for (const ch of text) {
        const { from, to } = v.state.selection.main;
        const handled = v.state
            .facet(EditorView.inputHandler)
            .some((h) => h(v, from, to, ch, () => v.state.update({})));
        if (!handled) v.dispatch(v.state.replaceSelection(ch), { userEvent: 'input.type' });
    }
}

const typed = (doc: string, text: string) => {
    const v = view(doc, [typography(on), wrapOnType]);
    type(v, text);
    return marked(v);
};

describe('smart typography', () => {
    it('curls quotes by context', () => {
        expect(typed('|', '"Hi," she said')).toBe('“Hi,” she said|');
        expect(typed('|', "it's 'fine'")).toBe('it’s ‘fine’|');
    });
    it('makes dashes and ellipses', () => {
        expect(typed('a|', '--b')).toBe('a—b|');
        expect(typed('wait|', '...')).toBe('wait…|');
    });
    it('leaves list markers and rules alone', () => {
        expect(typed('|', '--- ')).toBe('--- |');
        expect(typed('|', '- item')).toBe('- item|');
    });
    it('leaves code, JSX attributes and expressions alone', () => {
        expect(typed('`x|`', '"')).toBe('`x"|`');
        expect(typed('<Define word=|', "'")).toBe("<Define word='|");
        expect(typed('{fn(|', '"')).toBe('{fn("|');
    });
    it('leaves frontmatter alone', () => {
        expect(typed('---\ntitle: |\n---\n', '"')).toBe('---\ntitle: "|\n---\n');
    });
    it('makes the replacement its own undo step', () => {
        const v = view('|', [typography(on)]);
        type(v, '"');
        expect(marked(v)).toBe('“|');
        undo(v);
        expect(marked(v)).toBe('"|');
    });
});

describe('wrapOnType', () => {
    it('wraps a selection in the typed marker', () => {
        expect(typed('a [b] c', '_')).toBe('a _[b]_ c');
        expect(typed('a [b] c', '*')).toBe('a **[b]** c');
        expect(typed('a [b] c', '`')).toBe('a `[b]` c');
    });
});

describe('isProseAt', () => {
    it('is false inside inline code', () => {
        const v = view('a `co|de` b');
        expect(isProseAt(v.state, v.state.selection.main.head)).toBe(false);
    });
    it('is true in plain text', () => {
        const v = view('plain te|xt');
        expect(isProseAt(v.state, v.state.selection.main.head)).toBe(true);
    });
});
