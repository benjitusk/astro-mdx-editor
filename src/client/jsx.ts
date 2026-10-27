import { StateField, type Text } from '@codemirror/state';
import { metaField, type Meta } from './meta.ts';

/**
 * MDX component elements (capitalised JSX tags) found in the document.
 *
 * A small synchronous scanner rather than a full MDX parse: decorations need element boundaries on
 * every keystroke and cursor move, and it must cope with half-typed MDX (an unclosed tag stays raw
 * text instead of failing the whole document). Lowercase tags are HTML and are left alone.
 */

export interface JsxProp {
    name: string;
    /** The value as written, quotes or braces included; null for a bare attribute (`client:visible`). */
    raw: string | null;
    /** The string value for quoted props, else null. */
    value: string | null;
    from: number;
    to: number;
}

/**
 * - `block`: the opening and closing tags sit on their own lines, children on the lines between;
 * - `line`: a one-line element at the start of a line (`<Pull>…</Pull>`);
 * - `void`: a self-closing element that starts a line (it may span lines: `<Figure\n  …\n/>`);
 * - `inline`: anything else, inside running text.
 */
export type JsxKind = 'block' | 'line' | 'void' | 'inline';

export interface JsxElement {
    name: string;
    kind: JsxKind;
    from: number;
    to: number;
    /** End of the opening tag (after `>`). */
    openTo: number;
    /** Start of the closing tag (`</`); equals `to` for self-closing elements. */
    closeFrom: number;
    /** First and last child positions with text (block: whole lines; line: between the tags). */
    innerFrom: number;
    innerTo: number;
    props: JsxProp[];
    children: JsxElement[];
    /** Common indentation of a block's child lines, shown dedented in the frame. */
    childIndent: number;
}

const NAME = /[A-Za-z0-9_.:-]/;

interface OpenTag {
    name: string;
    from: number;
    to: number;
    selfClosing: boolean;
    props: JsxProp[];
}

/** Parse an opening tag at `from` (text[from] === '<'), honouring quotes and braces. */
function parseOpenTag(text: string, from: number): OpenTag | null {
    let i = from + 1;
    if (!/[A-Z]/.test(text[i] ?? '')) return null;
    let name = '';
    while (i < text.length && NAME.test(text[i])) name += text[i++];
    const props: JsxProp[] = [];
    for (;;) {
        while (i < text.length && /\s/.test(text[i])) i++;
        if (i >= text.length) return null;
        if (text[i] === '>') return { name, from, to: i + 1, selfClosing: false, props };
        if (text[i] === '/' && text[i + 1] === '>') return { name, from, to: i + 2, selfClosing: true, props };
        if (text[i] === '{') {
            // Spread props: {...rest}
            const end = skipBraces(text, i);
            if (end < 0) return null;
            props.push({ name: '', raw: text.slice(i, end), value: null, from: i, to: end });
            i = end;
            continue;
        }
        const start = i;
        let prop = '';
        while (i < text.length && NAME.test(text[i])) prop += text[i++];
        if (!prop) return null;
        while (text[i] === ' ' || text[i] === '\t') i++;
        if (text[i] !== '=') {
            props.push({ name: prop, raw: null, value: null, from: start, to: i });
            continue;
        }
        i++;
        while (text[i] === ' ' || text[i] === '\t') i++;
        const q = text[i];
        if (q === '"' || q === "'") {
            const end = text.indexOf(q, i + 1);
            if (end < 0) return null;
            props.push({
                name: prop,
                raw: text.slice(i, end + 1),
                value: text.slice(i + 1, end),
                from: start,
                to: end + 1,
            });
            i = end + 1;
        } else if (q === '{') {
            const end = skipBraces(text, i);
            if (end < 0) return null;
            props.push({ name: prop, raw: text.slice(i, end), value: null, from: start, to: end });
            i = end;
        } else return null;
    }
}

/** Index after the `}` matching the `{` at `from`, skipping strings; -1 if unbalanced. */
function skipBraces(text: string, from: number): number {
    let depth = 0;
    for (let i = from; i < text.length; i++) {
        const c = text[i];
        if (c === '"' || c === "'" || c === '`') {
            const end = text.indexOf(c, i + 1);
            if (end < 0) return -1;
            i = end;
        } else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) return i + 1;
    }
    return -1;
}

const lineStart = (text: string, pos: number) => text.lastIndexOf('\n', pos - 1) + 1;
const lineEnd = (text: string, pos: number) => {
    const n = text.indexOf('\n', pos);
    return n < 0 ? text.length : n;
};
const onlySpace = (s: string) => /^[ \t]*$/.test(s);

function classify(text: string, open: OpenTag, closeFrom: number, to: number): JsxKind {
    const startsLine = onlySpace(text.slice(lineStart(text, open.from), open.from));
    if (open.selfClosing)
        return startsLine && onlySpace(text.slice(open.to, lineEnd(text, open.to))) ? 'void' : 'inline';
    if (!startsLine || !onlySpace(text.slice(to, lineEnd(text, to)))) return 'inline';
    const sameLine = !text.slice(open.from, to).includes('\n');
    if (sameLine) return 'line';
    const tagEndsLine = onlySpace(text.slice(open.to, lineEnd(text, open.to)));
    const closeStartsLine = onlySpace(text.slice(lineStart(text, closeFrom), closeFrom));
    return tagEndsLine && closeStartsLine ? 'block' : 'inline';
}

function innerBounds(text: string, kind: JsxKind, openTo: number, closeFrom: number) {
    if (kind === 'line' || kind === 'inline') return { innerFrom: openTo, innerTo: closeFrom, childIndent: 0 };
    if (kind === 'void') return { innerFrom: openTo, innerTo: openTo - 1, childIndent: 0 };
    // block: whole lines between the tag lines, without the blank lines next to the tags.
    let from = lineEnd(text, openTo) + 1;
    let to = lineStart(text, closeFrom) - 1;
    while (from <= to && onlySpace(text.slice(from, lineEnd(text, from)))) from = lineEnd(text, from) + 1;
    while (to >= from && onlySpace(text.slice(lineStart(text, to), to))) to = lineStart(text, to) - 1;
    let indent = Infinity;
    if (from <= to) {
        for (const l of text.slice(from, to).split('\n'))
            if (l.trim()) indent = Math.min(indent, /^[ \t]*/.exec(l)![0].length);
    }
    return { innerFrom: from, innerTo: to, childIndent: Number.isFinite(indent) ? indent : 0 };
}

/** Ranges the scanner skips: frontmatter, ESM, fenced code. Inline code is skipped as it's met. */
function skipRanges(text: string, meta: Meta): [number, number][] {
    const out: [number, number][] = [];
    if (meta.frontmatter) out.push([meta.frontmatter.from, meta.frontmatter.to]);
    for (const s of meta.esm) out.push([s.from, s.to]);
    const fence = /^[ \t]*(```|~~~)/gm;
    let open: number | null = null;
    for (const m of text.matchAll(fence)) {
        if (open === null) open = m.index!;
        else {
            out.push([open, lineEnd(text, m.index!)]);
            open = null;
        }
    }
    if (open !== null) out.push([open, text.length]);
    return out.sort((a, b) => a[0] - b[0]);
}

export function scanJsx(text: string, meta: Meta): JsxElement[] {
    const roots: JsxElement[] = [];
    const stack: { open: OpenTag; children: JsxElement[] }[] = [];
    const skips = skipRanges(text, meta);
    let skip = 0;
    for (let i = 0; i < text.length; i++) {
        while (skip < skips.length && skips[skip][1] < i) skip++;
        if (skip < skips.length && i >= skips[skip][0]) {
            i = skips[skip][1];
            continue;
        }
        const c = text[i];
        if (c === '`') {
            // Inline code: skip to the matching backtick run on the same line.
            let run = 1;
            while (text[i + run] === '`') run++;
            const close = text.indexOf('`'.repeat(run), i + run);
            const nl = text.indexOf('\n', i);
            if (close >= 0 && (nl < 0 || close < nl)) i = close + run - 1;
            else i += run - 1;
            continue;
        }
        if (c !== '<') continue;
        if (text[i + 1] === '/') {
            const m = /^<\/([A-Za-z0-9_.:-]+)\s*>/.exec(text.slice(i, i + 80));
            if (!m || !/[A-Z]/.test(m[1][0])) continue;
            const at = stack.map((s) => s.open.name).lastIndexOf(m[1]);
            if (at < 0) continue;
            // Close the element. Tags opened inside it and left unclosed stay raw; their children
            // move up into this element.
            const frame = stack[at];
            for (const unclosed of stack.slice(at + 1)) frame.children.push(...unclosed.children);
            stack.length = at;
            const to = i + m[0].length;
            const kind = classify(text, frame.open, i, to);
            const el: JsxElement = {
                name: frame.open.name,
                kind,
                from: frame.open.from,
                to,
                openTo: frame.open.to,
                closeFrom: i,
                props: frame.open.props,
                children: frame.children,
                ...innerBounds(text, kind, frame.open.to, i),
            };
            (stack.at(-1)?.children ?? roots).push(el);
            i = to - 1;
            continue;
        }
        const open = parseOpenTag(text, i);
        if (!open) continue;
        if (open.selfClosing) {
            const kind = classify(text, open, open.to, open.to);
            const el: JsxElement = {
                name: open.name,
                kind,
                from: open.from,
                to: open.to,
                openTo: open.to,
                closeFrom: open.to,
                props: open.props,
                children: [],
                ...innerBounds(text, kind, open.to, open.to),
            };
            (stack.at(-1)?.children ?? roots).push(el);
        } else stack.push({ open, children: [] });
        i = open.to - 1;
    }
    // Unclosed at the end (usually mid-typing): the tags stay raw, their children still count.
    for (const unclosed of stack) roots.push(...unclosed.children);
    return roots.sort((a, b) => a.from - b.from);
}

export const jsxField = StateField.define<JsxElement[]>({
    create: (state) => scanJsx(state.doc.toString(), state.field(metaField)),
    update: (value, tr) => (tr.docChanged ? scanJsx(tr.state.doc.toString(), tr.state.field(metaField)) : value),
});

/** Every element, depth first. */
export function* allElements(els: JsxElement[]): Generator<JsxElement> {
    for (const el of els) {
        yield el;
        yield* allElements(el.children);
    }
}

/** The innermost element containing `pos` (tags included). */
export function elementAt(els: JsxElement[], pos: number): JsxElement | null {
    for (const el of els) {
        if (pos >= el.from && pos <= el.to) return elementAt(el.children, pos) ?? el;
    }
    return null;
}

export const docLineStart = (doc: Text, pos: number) => doc.lineAt(pos).from;
export const docLineEnd = (doc: Text, pos: number) => doc.lineAt(pos).to;
