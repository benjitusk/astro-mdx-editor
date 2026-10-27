import { EditorSelection } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { livePreview } from '../../src/client/livepreview.ts';
import { findMeta } from '../../src/client/meta.ts';
import { applyMinimalChange } from '../../src/client/save.ts';
import { marked, view } from './helpers.ts';

const hiddenText = (v: ReturnType<typeof view>) => {
    const out: string[] = [];
    v.state.field(livePreview).decorations.between(0, v.state.doc.length, (from, to, d) => {
        if (d.spec.widget === undefined && (d as unknown as { point: boolean }).point && to > from) {
            out.push(v.state.sliceDoc(from, to));
        }
    });
    return out;
};

describe('live preview', () => {
    it('hides block markers away from the cursor and keeps them near it', () => {
        const away = view('## Title\n\n> quote\n\ntext|');
        expect(hiddenText(away)).toEqual(expect.arrayContaining(['## ', '> ']));
        const near = view('## Ti|tle\n\n> quote');
        expect(hiddenText(near)).not.toContain('## ');
    });
    it('hides inline markers unless the cursor touches the span', () => {
        expect(hiddenText(view('an _em_ word|'))).toEqual(['_', '_']);
        expect(hiddenText(view('an _e|m_ word'))).toEqual([]);
    });
    it('hides a link destination off-cursor', () => {
        expect(hiddenText(view('see \\[x\\](http://a.b) now|'))).toEqual(['[', '](http://a.b)']);
    });
    it('does not treat a callout marker as a link', () => {
        expect(hiddenText(view('> \\[!question\\] Title\n> body\n\n|'))).toEqual(['> ', '> ']);
    });
    it('leaves frontmatter raw', () => {
        expect(hiddenText(view('---\ntitle: _x_\n---\n\nbody|'))).toEqual([]);
    });
});

describe('leanToContent', () => {
    it('moves a click at a hidden heading marker to the text', () => {
        const v = view('## Title\n\nbody|');
        v.dispatch({ selection: EditorSelection.cursor(0), userEvent: 'select.pointer' });
        expect(marked(v)).toBe('## |Title\n\nbody');
    });
    it('leaves keyboard moves alone', () => {
        const v = view('## Title\n\nbody|');
        v.dispatch({ selection: EditorSelection.cursor(0), userEvent: 'select' });
        expect(v.state.selection.main.head).toBe(0);
    });
});

describe('findMeta', () => {
    it('finds frontmatter and ESM lines', () => {
        const v = view("---\na: 1\n---\n\nimport X from './x';\n\nbody");
        const meta = findMeta(v.state.doc);
        expect(meta.frontmatter).toEqual({ from: 0, to: 12 });
        expect(meta.esm).toHaveLength(1);
    });
    it('ignores import lines inside code fences', () => {
        const v = view('```js\nimport x from "y";\n```');
        expect(findMeta(v.state.doc).esm).toEqual([]);
    });
});

describe('applyMinimalChange', () => {
    it('replaces only the differing span, so the cursor survives', () => {
        const v = view('one two thr|ee four');
        applyMinimalChange(v, 'one TWO three four');
        expect(marked(v)).toBe('one TWO thr|ee four');
    });
});
