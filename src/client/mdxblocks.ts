import type { BlockContext, Line, MarkdownConfig } from '@lezer/markdown';

/**
 * Component tags as MDX reads them, for Lezer's Markdown parser (whose HTML blocks run on to the next
 * blank line, and whose lists stop at 4 spaces of indentation):
 *
 * - A lone opening tag (`<Callout title='x'>`) starts an `MdxBlock` composite. Its children are parsed
 *   relative to their own indentation, so the notebook's 4-space-indented children (lists included)
 *   parse as they do at the top level. It ends at the matching closing tag (`MdxTag`s mark both tags'
 *   lines; the closing one is outside the composite).
 * - A lone self-closing tag, a lone closing tag, and a tag written over several lines are one-line (or
 *   few-line) `HTMLBlock`s, never more.
 *
 * Everything else (`<Pull>text</Pull>`, a tag mid-paragraph) is left to the Markdown parser as before.
 */

/** Element names by id, so a composite's numeric value can say which tag closes it. */
const names: string[] = [];
const idOf = (name: string) => {
    let i = names.indexOf(name);
    if (i < 0) i = names.push(name) - 1;
    return i;
};
const encode = (id: number, tagIndent: number, childIndent: number) => id * 1_000_000 + tagIndent * 1000 + childIndent;
const decode = (v: number) => ({
    name: names[Math.floor(v / 1_000_000)],
    tagIndent: Math.floor(v / 1000) % 1000,
    childIndent: v % 1000,
});

interface Input {
    length: number;
    read(from: number, to: number): string;
}
const inputOf = (cx: BlockContext) => (cx as unknown as { input: Input }).input;

/** The end of the tag starting at `text[0]` (`<`), past quoted strings and `{…}`, or -1. */
export function tagEnd(text: string): number {
    let depth = 0;
    let quote = '';
    for (let i = 1; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            if (c === quote) quote = '';
        } else if (c === '"' || c === "'" || (c === '`' && depth)) quote = c;
        else if (c === '{') depth++;
        else if (c === '}') depth = Math.max(0, depth - 1);
        else if (c === '>' && !depth) return i + 1;
    }
    return -1;
}

const columns = (s: string) => {
    let n = 0;
    for (const c of s) n += c === '\t' ? 4 - (n % 4) : 1;
    return n;
};

/** The indentation of the first non-blank line after `from`, unless that line closes the element. */
function childIndentAfter(input: Input, from: number, tagIndent: number): number {
    const text = input.read(from, Math.min(input.length, from + 4000));
    for (const l of text.split('\n').slice(1, 60)) {
        if (!l.trim()) continue;
        if (/^\s*<\//.test(l)) return tagIndent;
        return Math.max(tagIndent, columns(/^\s*/.exec(l)![0]));
    }
    return tagIndent;
}

/** A component tag alone on its line(s) at the line's position, or null. */
function loneTag(cx: BlockContext, line: Line) {
    if (line.next !== 60 /* < */) return null;
    const head = /^<(\/?)([A-Z][\w.]*)(?=[\s>/]|$)/.exec(line.text.slice(line.pos));
    if (!head) return null; // components only; HTML stays HTML
    const start = cx.lineStart + line.pos;
    const input = inputOf(cx);
    const text = input.read(start, Math.min(input.length, start + 8000));
    const end = tagEnd(text);
    if (end < 0) return null;
    const tag = text.slice(0, end);
    const lineEnd = text.indexOf('\n', end);
    // `<Pull>text</Pull>`, a tag mid-paragraph: Markdown's business.
    if (text.slice(end, lineEnd < 0 ? text.length : lineEnd).trim()) return null;
    return {
        start,
        end: start + end,
        name: head[2],
        lines: tag.split('\n').length,
        open: !head[1] && !/\/\s*>$/.test(tag),
        input,
    };
}

function parseTag(cx: BlockContext, line: Line): boolean | null {
    const tag = loneTag(cx, line);
    if (!tag) return false;
    if (tag.open && tag.lines === 1) {
        const tagIndent = line.indent;
        const childIndent = childIndentAfter(tag.input, tag.start, tagIndent);
        cx.startComposite('MdxBlock', line.pos, encode(idOf(tag.name), tagIndent, childIndent));
        cx.addElement(cx.elt('MdxTag', tag.start, tag.end));
        line.moveBase(line.text.length);
        return null;
    }
    // A self-closing or closing tag, or a tag over several lines: just its lines.
    for (let i = 1; i < tag.lines; i++) cx.nextLine();
    cx.addElement(cx.elt('HTMLBlock', tag.start, tag.end));
    cx.nextLine();
    return true;
}

export const mdxBlocks: MarkdownConfig = {
    defineNodes: [
        {
            name: 'MdxBlock',
            block: true,
            composite(_cx, line, value) {
                if (line.next === -1) return true;
                const { name, tagIndent, childIndent } = decode(value);
                const close = /^<\/([A-Za-z][\w.]*)?\s*>/.exec(line.text.slice(line.pos));
                if (close && (close[1] === name || line.indent <= tagIndent)) return false;
                line.moveBaseColumn(Math.min(line.indent, childIndent));
                return true;
            },
        },
        { name: 'MdxTag' },
    ],
    // A tag line ends a paragraph above it, as in MDX.
    parseBlock: [{ name: 'MdxTag', before: 'HTMLBlock', parse: parseTag, endLeaf: (cx, line) => !!loneTag(cx, line) }],
};
