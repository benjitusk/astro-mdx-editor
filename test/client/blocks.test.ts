import { describe, expect, it } from 'vitest';
import { listIndentAt, livePreview } from '../../src/client/livepreview.ts';
import { cellHtml } from '../../src/client/tables.ts';
import { view } from './helpers.ts';

const joined = (src: string) => [...view(src).state.field(livePreview).joined].sort();
const widgetNames = (src: string) => {
    const v = view(src);
    const out: string[] = [];
    v.state.field(livePreview).decorations.between(0, v.state.doc.length, (from, to, d) => {
        const w = d.spec.widget;
        if (w) out.push(`${w.constructor.name}@${v.state.doc.lineAt(from).number}`);
    });
    return out;
};

describe('soft-wrapped paragraphs', () => {
    it('joins the lines of a paragraph, not hard breaks, imports, quotes or components', () => {
        expect(joined('One\ntwo\nthree.|\n\nNext.')).toEqual([2, 3]);
        expect(joined('Hard  \nbreak\\\\\nhere.|')).toEqual([]);
        expect(joined("import a from 'a';\nimport b from 'b';\n\nText|")).toEqual([]);
        expect(joined('> quote\n> more\n\n|')).toEqual([]);
        expect(joined('<Note>\n\nIn a\nnote.\n\n</Note>\n\n|')).toEqual([]);
    });
    it('joins list item continuations', () => {
        expect(joined('- item\n  continues\n\n|')).toEqual([2]);
    });
});

describe('tables and tasks', () => {
    it('draws a table off-cursor and shows its source on it', () => {
        // `|` is the helper's cursor mark, so the table's pipes are escaped.
        const src = '| a | b |\n| - | - |\n| 1 | 2 |'.replace(/\|/g, '\\|');
        expect(widgetNames(`${src}\n\n|`)).toEqual(['TableWidget@1']);
        expect(widgetNames(`|${src}`)).toEqual([]);
    });
    it('renders a cell’s inline Markdown', () => {
        expect(cellHtml('`a|b` **b** _c_ [d](e) x\\|y <z>')).toBe(
            '<code>a|b</code> <strong>b</strong> <em>c</em> <a>d</a> x|y &lt;z&gt;'
        );
    });
    it('shows task markers as checkboxes', () => {
        expect(widgetNames('- \\[x\\] done\n- \\[ \\] not\n\n|')).toEqual(['TaskWidget@1', 'TaskWidget@2']);
    });
    it('indents blocks by the list items they are in', () => {
        const v = view('- item\n\n    <Counter />\n\nTop.');
        expect(listIndentAt(v.state, v.state.doc.toString().indexOf('<Counter'))).toBe('1.5rem');
        expect(listIndentAt(v.state, v.state.doc.toString().indexOf('Top'))).toBeNull();
    });
});
