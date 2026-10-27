/**
 * Map a click in a rendered component back to the source text.
 *
 * Rendered text and source differ by markup (`**`, `_`, list numbers, link targets, nested tags),
 * whitespace and quote style. Both sides are normalised into comparable strings with an index map
 * back to the original, then the text around the click is looked up in the source: the longest
 * unique match wins, and ties go to the occurrence nearest the click's relative position. Text that
 * isn't in the source (component chrome: a headword, an attribution) maps to null.
 */

interface Normalised {
    text: string;
    /** For each character of `text`, its index in the original. */
    map: number[];
}

const QUOTES: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"' };

function normaliseChars(chars: Iterable<[string, number]>): Normalised {
    let text = '';
    const map: number[] = [];
    let space = false;
    for (const [c, i] of chars) {
        if (/\s/.test(c)) {
            if (!space && text) {
                text += ' ';
                map.push(i);
            }
            space = true;
            continue;
        }
        space = false;
        text += QUOTES[c] ?? c;
        map.push(i);
    }
    return { text, map };
}

/** Source characters that render as text: no tags, link targets, list/quote/heading markers or emphasis marks. */
export function normaliseSource(source: string): Normalised {
    const skip = new Uint8Array(source.length);
    const mark = (from: number, to: number) => skip.fill(1, from, to);
    for (const m of source.matchAll(/<\/?[A-Za-z][^>]*>/g)) mark(m.index!, m.index! + m[0].length);
    for (const m of source.matchAll(/\]\([^)\n]*\)/g)) mark(m.index!, m.index! + m[0].length);
    for (const m of source.matchAll(/^[ \t]*(?:(?:[-*+]|\d+[.)]|>|#{1,6})[ \t]+)+/gm))
        mark(m.index!, m.index! + m[0].length);
    for (const m of source.matchAll(/[*_~`[]|\\(?=[^\s\w])/g)) mark(m.index!, m.index! + 1);
    function* chars(): Generator<[string, number]> {
        for (let i = 0; i < source.length; i++) if (!skip[i]) yield [source[i], i];
    }
    return normaliseChars(chars());
}

export function normaliseRendered(text: string): Normalised {
    function* chars(): Generator<[string, number]> {
        for (let i = 0; i < text.length; i++) yield [text[i], i];
    }
    return normaliseChars(chars());
}

const LENGTHS = [32, 20, 12, 8, 6];

function occurrences(hay: string, needle: string): number[] {
    const out: number[] = [];
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) out.push(i);
    return out;
}

/** The source offset for a click at `at` in `rendered` text, or null when the text isn't in the source. */
export function sourceOffsetFor(source: string, rendered: string, at: number): number | null {
    const src = normaliseSource(source);
    const ren = normaliseRendered(rendered);
    // The normalised index of the click: the first kept rendered character at or after it.
    let atN = ren.map.findIndex((i) => i >= at);
    if (atN < 0) atN = ren.text.length;
    const ratio = ren.text.length ? atN / ren.text.length : 0;
    const nearest = (hits: number[]) =>
        hits.reduce((best, h) =>
            Math.abs(h / src.text.length - ratio) < Math.abs(best / src.text.length - ratio) ? h : best
        );

    for (const len of LENGTHS) {
        const after = ren.text.slice(atN, atN + len);
        if (after.trim().length >= Math.min(len, 6) && after.length === len) {
            const hits = occurrences(src.text, after);
            if (hits.length) return src.map[nearest(hits)];
        }
        const before = ren.text.slice(Math.max(0, atN - len), atN);
        if (before.trim().length >= Math.min(len, 6) && before.length === len) {
            const hits = occurrences(src.text, before);
            if (hits.length) {
                const end = nearest(hits) + len - 1;
                return src.map[end] + 1;
            }
        }
    }
    return null;
}

/** The text of rendered DOM with block boundaries as spaces, and where a DOM point falls in it. */
export function renderedText(root: Element, point: { node: Node; offset: number } | null) {
    let text = '';
    let at = -1;
    let lastBlock: Element | null = null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const block = blockAncestor(node.parentElement, root);
        if (lastBlock && block !== lastBlock) text += ' ';
        lastBlock = block;
        if (point && node === point.node) at = text.length + point.offset;
        text += node.nodeValue ?? '';
    }
    return { text, at };
}

function blockAncestor(el: Element | null, root: Element): Element {
    for (let e = el; e && e !== root; e = e.parentElement) {
        if (!getComputedStyle(e).display.startsWith('inline')) return e;
    }
    return root;
}

/** The DOM text position under a viewport point. */
export function caretPoint(x: number, y: number): { node: Node; offset: number } | null {
    const doc = document as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    const pos = doc.caretPositionFromPoint?.(x, y);
    if (pos) return { node: pos.offsetNode, offset: pos.offset };
    const range = document.caretRangeFromPoint?.(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
}
