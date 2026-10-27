import { syntaxTree } from '@codemirror/language';
import { describe, expect, it } from 'vitest';
import { tagEnd } from '../../src/client/mdxblocks.ts';
import { view } from './helpers.ts';

/** The tree's node names with their text, one per line, for the node types given. */
function nodes(src: string, types: string[]) {
    const v = view(src);
    const out: string[] = [];
    syntaxTree(v.state).iterate({
        enter: (n) => {
            if (types.includes(n.name)) out.push(`${n.name}: ${v.state.sliceDoc(n.from, n.to).split('\n')[0].trim()}`);
        },
    });
    return out;
}

describe('MDX blocks', () => {
    it('parses indented children relative to their indent, lists included', () => {
        const src = [
            "<Callout variant='note' title='Plan'>",
            '    1. One',
            '    2. Two',
            '',
            '    3. Three',
            '        - nested',
            '    4. Four',
            '',
            '</Callout>',
            '',
            'After.',
        ].join('\n');
        expect(
            nodes(src, ['MdxBlock', 'MdxTag', 'OrderedList', 'BulletList', 'ListItem', 'HTMLBlock', 'Paragraph'])
        ).toEqual([
            "MdxBlock: <Callout variant='note' title='Plan'>",
            "MdxTag: <Callout variant='note' title='Plan'>",
            'OrderedList: 1. One',
            'ListItem: 1. One',
            'Paragraph: One',
            'ListItem: 2. Two',
            'Paragraph: Two',
            'ListItem: 3. Three',
            'Paragraph: Three',
            'BulletList: - nested',
            'ListItem: - nested',
            'Paragraph: nested',
            'ListItem: 4. Four',
            'Paragraph: Four',
            'HTMLBlock: </Callout>',
            'Paragraph: After.',
        ]);
    });
    it('keeps text right after an opening tag as Markdown', () => {
        expect(nodes('<Note>\nText _here_.\n</Note>', ['MdxBlock', 'Paragraph', 'Emphasis', 'HTMLBlock'])).toEqual([
            'MdxBlock: <Note>',
            'Paragraph: Text _here_.',
            'Emphasis: _here_',
            'HTMLBlock: </Note>',
        ]);
    });
    it('makes self-closing and multi-line tags blocks of their own lines', () => {
        const src = "<Counter client:visible />\nText.\n\n<Figure\n    src={a}\n    alt='x > y'\n/>\nMore.";
        expect(nodes(src, ['HTMLBlock', 'Paragraph'])).toEqual([
            'HTMLBlock: <Counter client:visible />',
            'Paragraph: Text.',
            'HTMLBlock: <Figure',
            'Paragraph: More.',
        ]);
    });
    it('leaves one-line elements, inline tags and HTML to Markdown', () => {
        expect(
            nodes('<Pull>Big.</Pull>\n\n<Pos>n</Pos> is a noun.\n\n<div>\nx\n</div>', [
                'MdxBlock',
                'Paragraph',
                'HTMLBlock',
            ])
        ).toEqual(['Paragraph: <Pull>Big.</Pull>', 'Paragraph: <Pos>n</Pos> is a noun.', 'HTMLBlock: <div>']);
    });
    it('finds where a tag ends, past quotes and braces', () => {
        expect(tagEnd("<A b='>' c={x > 1 ? '}' : 2}>rest")).toBe(29);
    });
});
