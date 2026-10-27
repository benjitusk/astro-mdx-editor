import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { elementAt, scanJsx, type JsxElement } from '../../src/client/jsx.ts';
import { findMeta } from '../../src/client/meta.ts';

const scan = (src: string) => scanJsx(src, findMeta(Text.of(src.split('\n'))));
const brief = (els: JsxElement[]): unknown[] =>
    els.map((e) => ({ name: e.name, kind: e.kind, ...(e.children.length ? { children: brief(e.children) } : {}) }));

describe('scanJsx', () => {
    it('finds block elements and their children lines', () => {
        const src = "Intro\n\n<Define word='judge' pos='verb'>\n\n1. one\n2. two\n\n</Define>\n";
        const [el] = scan(src);
        expect(el).toMatchObject({ name: 'Define', kind: 'block' });
        expect(src.slice(el.innerFrom, el.innerTo)).toBe('1. one\n2. two');
        expect(el.props.map((p) => [p.name, p.value])).toEqual([
            ['word', 'judge'],
            ['pos', 'verb'],
        ]);
    });
    it('nests components and leaves lowercase HTML alone', () => {
        const src =
            "<Define word='v'>\n\n<Pos name='noun'>\n\n1. x\n\n</Pos>\n\n</Define>\n\n<Note>\n<div dir=\"rtl\">\n\n> q\n\n</div>\n</Note>";
        expect(brief(scan(src))).toEqual([
            { name: 'Define', kind: 'block', children: [{ name: 'Pos', kind: 'block' }] },
            { name: 'Note', kind: 'block' },
        ]);
    });
    it('classifies one-line, void and inline elements', () => {
        const src =
            "<Pull>Judgment is the medium.</Pull>\n\n<Figure\n    src={img}\n    alt='A \"quoted\" > thing'\n/>\n\nSee <Pos name='n'>x</Pos> here.";
        expect(brief(scan(src))).toEqual([
            { name: 'Pull', kind: 'line' },
            { name: 'Figure', kind: 'void' },
            { name: 'Pos', kind: 'inline' },
        ]);
        const figure = scan(src)[1];
        expect(figure.props.map((p) => [p.name, p.raw])).toEqual([
            ['src', '{img}'],
            ['alt', `'A "quoted" > thing'`],
        ]);
    });
    it('measures the indentation of indented children', () => {
        const src = "<Callout variant='warning'>\n    If you don't set it,\n    Batch falls back.\n</Callout>";
        const [el] = scan(src);
        expect(el.kind).toBe('block');
        expect(el.childIndent).toBe(4);
        expect(src.slice(el.innerFrom, el.innerTo)).toBe("    If you don't set it,\n    Batch falls back.");
    });
    it('treats an empty element as a block with no children', () => {
        const [el] = scan("<Callout variant='discovery' label='Next'></Callout>");
        expect(el.kind).toBe('line');
        expect(el.innerFrom).toBe(el.innerTo);
    });
    it('ignores tags in code, frontmatter and imports', () => {
        const src =
            "---\ntitle: <Nope>\n---\n\nimport Callout from './C.astro';\n\n```md\n<Counter client:visible />\n```\n\nUse `<Pull>` like this.\n\n    <Counter client:visible />\n";
        expect(brief(scan(src))).toEqual([{ name: 'Counter', kind: 'void' }]);
    });
    it('keeps unclosed elements raw instead of failing', () => {
        const src = "<Define word='x'>\n\n- a\n\n<Pull>ok</Pull>";
        expect(brief(scan(src))).toEqual([{ name: 'Pull', kind: 'line' }]);
    });
    it('finds the innermost element at a position', () => {
        const src = "<Define word='v'>\n\n<Pos name='noun'>\n\nx\n\n</Pos>\n\n</Define>";
        const els = scan(src);
        expect(elementAt(els, src.indexOf('x'))?.name).toBe('Pos');
        expect(elementAt(els, 2)?.name).toBe('Define');
    });
});
