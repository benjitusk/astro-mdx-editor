import { EditorSelection } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { setCallout, setCalloutLooks } from '../../src/client/callouts.ts';
import { livePreview } from '../../src/client/livepreview.ts';
import { marked, view } from './helpers.ts';

const lineClasses = (v: ReturnType<typeof view>) => {
    const out: string[] = [];
    v.state.field(livePreview).decorations.between(0, v.state.doc.length, (from, to, d) => {
        if (from === to && d.spec.class) out.push(`${v.state.doc.lineAt(from).number}: ${d.spec.class}`);
    });
    return out;
};
const atomic = (v: ReturnType<typeof view>) => {
    const out: string[] = [];
    v.state.field(livePreview).atomic.between(0, v.state.doc.length, (from, to) => {
        out.push(v.state.sliceDoc(from, to));
    });
    return out;
};
const apply = (v: ReturnType<typeof view>, type: string) => v.dispatch(setCallout(v.state, type));

describe('callouts', () => {
    it('draws a callout as a card, title line then body lines', () => {
        const v = view('> \\[!question\\] The question\n> One\n> Two\n\n|');
        expect(lineClasses(v)).toEqual([
            '1: md-callout md-callout-first md-callout-title',
            '2: md-callout md-callout-body-first',
            '3: md-callout md-callout-last',
            '4: md-blank',
            '5: md-blank',
        ]);
        expect(atomic(v)).toEqual(['[!question] ']);
    });
    it('keeps plain quotes and unknown types as quotes', () => {
        for (const doc of ['> plain\n\n|', '> \\[!nope\\] x\n\n|']) {
            expect(lineClasses(view(doc))[0]).toBe('1: md-bq md-bq-first md-bq-last');
        }
    });
    it("follows the site's render once measured: types it doesn't render as callouts are quotes", () => {
        const v = view('> \\[!tip\\] x\n\n|');
        v.dispatch({ effects: setCalloutLooks.of(new Map([['note', { icon: '', title: 'Note', color: '' }]])) });
        expect(lineClasses(v)[0]).toBe('1: md-bq md-bq-first md-bq-last');
    });
    it('puts a click left of the title after both hidden prefixes', () => {
        const v = view('> \\[!note\\] Title\n> body\n\nend|');
        v.dispatch({ selection: EditorSelection.cursor(0), userEvent: 'select.pointer' });
        expect(marked(v)).toBe('> [!note] |Title\n> body\n\nend');
    });
});

describe('setCallout', () => {
    it('starts a callout on a blank line, apart from the text around it', () => {
        const v = view('Above\n|\nBelow');
        apply(v, 'tip');
        expect(marked(v)).toBe('Above\n\n> [!tip] |\n\nBelow');
    });
    it('quotes the paragraph at the cursor under a marker line', () => {
        const v = view('Intro\n\nOne li|ne\nand two\n\nAfter');
        apply(v, 'note');
        expect(marked(v)).toBe('Intro\n\n> [!note]\n> One li|ne\n> and two\n\nAfter');
    });
    it('adds a marker line to a plain quote', () => {
        const v = view('> qu|ote');
        apply(v, 'warning');
        expect(marked(v)).toBe('> [!warning]\n> qu|ote');
    });
    it("changes a callout's type and keeps its title", () => {
        const v = view('> \\[!note\\]- Folded title\n> bo|dy');
        apply(v, 'bug');
        expect(marked(v)).toBe('> [!bug]- Folded title\n> bo|dy');
    });
});
