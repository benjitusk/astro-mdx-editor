import { EditorView } from '@codemirror/view';
import { h } from './dom.ts';
import { blockRange, renderedAt } from './components.ts';
import { allElements, jsxField } from './jsx.ts';
import { livePreview } from './livepreview.ts';

/**
 * Click-accuracy test, run in the real page (`?selftest`) so the site's fonts and CSS are in play.
 *
 * For sampled characters on every kind of line, it clicks the left edge of the character, both with
 * the cursor elsewhere (markers hidden) and with the cursor on the same line (markers revealed), and
 * checks the caret lands right before that character. It also clicks just left of each line's text,
 * where hidden or hanging markers sit, and expects the caret at the start of the text. It never
 * edits the document.
 */

export interface Failure {
    case: string;
    line: number;
    expected: number;
    got: number;
    context: string;
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

function hiddenRanges(view: EditorView): [number, number][] {
    const out: [number, number][] = [];
    view.state.field(livePreview).decorations.between(0, view.state.doc.length, (from, to, d) => {
        if ((d as unknown as { point: boolean }).point && to > from) out.push([from, to]);
    });
    return out;
}

async function click(view: EditorView, x: number, y: number) {
    const target = document.elementFromPoint(x, y) ?? view.contentDOM;
    const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, detail: 1 };
    target.dispatchEvent(new MouseEvent('mousedown', init));
    target.dispatchEvent(new MouseEvent('mouseup', init));
    window.dispatchEvent(new MouseEvent('mouseup', init));
    await frame();
    return view.state.selection.main.head;
}

function prefixRanges(view: EditorView): [number, number][] {
    const out: [number, number][] = [];
    view.state.field(livePreview).prefixes.between(0, view.state.doc.length, (from, to) => {
        out.push([from, to]);
    });
    return out;
}

function samples(view: EditorView) {
    const { doc } = view.state;
    const hidden = hiddenRanges(view);
    // Hanging markers (list numbers) are visible but aren't text: clicking one means its item's text.
    const prefixes = prefixRanges(view);
    const inRange = (ranges: [number, number][], p: number) => ranges.some(([f, t]) => p >= f && p < t);
    const out: { pos: number; line: number; kind: string; expect?: number; marked?: boolean }[] = [];
    for (let n = 1; n <= doc.lines; n++) {
        const l = doc.line(n);
        if (!l.text.trim()) continue;
        const visible = [];
        for (let p = l.from; p < l.to; p++) {
            if (!inRange(hidden, p) && !inRange(prefixes, p) && l.text[p - l.from] !== ' ') visible.push(p);
        }
        if (!visible.length) continue;
        const marker = prefixes.find(([f, t]) => f >= l.from && t <= l.to && !inRange(hidden, f));
        if (marker) out.push({ pos: marker[0], line: n, kind: 'hanging marker', expect: marker[1] });
        const before = visible[0] - 1;
        const marked = before >= l.from && (inRange(hidden, before) || inRange(prefixes, before));
        out.push({ pos: visible[0], line: n, kind: 'text start', marked });
        out.push({ pos: visible[Math.floor(visible.length / 2)], line: n, kind: 'mid line' });
        const lineEnd = visible.at(-1)!;
        if (lineEnd !== visible[0]) out.push({ pos: lineEnd, line: n, kind: 'last char' });
    }
    return out;
}

export async function runSelfTest(view: EditorView, onProgress?: (done: number, total: number) => void) {
    const failures: Failure[] = [];
    const initial = view.state.selection;
    const away = (n: number) => {
        const { doc } = view.state;
        const target = n > doc.lines / 2 ? 1 : doc.lines;
        return doc.line(target).from;
    };
    const cases = samples(view);
    let checks = 0;
    for (const [i, s] of cases.entries()) {
        const line = view.state.doc.line(s.line);
        for (const state of ['cursor elsewhere', 'cursor on line'] as const) {
            const anchor = state === 'cursor elsewhere' ? away(s.line) : line.to;
            if (state === 'cursor on line' && anchor === s.pos) continue;
            view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(s.pos, { y: 'center' }) });
            await frame();
            // Text inside a rendered component isn't on screen as text; renderedClicks covers it.
            if (renderedAt(view.state, s.pos)) continue;
            // coordsAtPos gives caret positions; the character spans from its own to the next one's.
            const rect = view.coordsAtPos(s.pos, 1);
            const next = view.coordsAtPos(s.pos + 1, -1);
            if (!rect || !next || Math.abs(next.top - rect.top) > 2 || next.left - rect.left < 3) continue;
            const y = (rect.top + rect.bottom) / 2;
            const tests: [string, number, number][] = [[`${s.kind}, ${state}`, rect.left + 1.5, s.expect ?? s.pos]];
            // Just left of the text, where a hidden or hanging marker sits, but only inside the editor
            // (left of the column is page margin, which the editor doesn't handle).
            // Only where a marker sits there; landing in visible indentation is right.
            const content = view.contentDOM.getBoundingClientRect();
            const markerBefore = s.pos === line.from || s.marked;
            if (s.kind === 'text start' && markerBefore && rect.left - 2 > content.left) {
                tests.push([`left of text, ${state}`, rect.left - 2, s.pos]);
            }
            for (const [name, x, expected] of tests) {
                view.dispatch({ selection: { anchor } });
                await frame();
                const got = await click(view, x, y);
                checks++;
                if (got !== expected) {
                    failures.push({
                        case: name,
                        line: s.line,
                        expected,
                        got,
                        context: view.state.sliceDoc(
                            Math.max(line.from, expected - 12),
                            Math.min(line.to, expected + 12)
                        ),
                    });
                }
            }
        }
        onProgress?.(i + 1, cases.length);
    }
    const rendered = await renderedClicks(view, away);
    checks += rendered.checks;
    failures.push(...rendered.failures);
    view.dispatch({ selection: initial });
    return { checks, failures, renderedChecks: rendered.checks };
}

/**
 * Clicking a word in a rendered component should enter it with the caret right before that word in
 * the source. Words are picked that occur once in the element's source and aren't in its tags.
 */
async function renderedClicks(view: EditorView, away: (line: number) => number) {
    const failures: Failure[] = [];
    let checks = 0;
    const elements = [...allElements(view.state.field(jsxField))].filter(
        (e) => e.kind === 'block' || e.kind === 'line'
    );
    for (const el of elements) {
        const line = view.state.doc.lineAt(el.from).number;
        view.dispatch({
            selection: { anchor: away(line) },
            effects: EditorView.scrollIntoView(el.from, { y: 'center' }),
        });
        await frame();
        await frame();
        const { from } = blockRange(view.state, el);
        const dom = [...view.contentDOM.querySelectorAll<HTMLElement>('.mdx-render')].find(
            (d) => view.posAtDOM(d) === from
        );
        if (!dom || dom.querySelector('.mdx-pending')) continue;
        const source = view.state.sliceDoc(el.from, el.to);
        const words: { node: Text; offset: number; word: string }[] = [];
        const walker = document.createTreeWalker(dom.querySelector('.mdx-html') ?? dom, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode() as Text | null; n && words.length < 3; n = walker.nextNode() as Text | null) {
            for (const m of n.data.matchAll(/[A-Za-z]{5,}/g)) {
                const at = source.indexOf(m[0]);
                const inChildren = at >= el.innerFrom - el.from && at < el.innerTo - el.from;
                if (at >= 0 && source.indexOf(m[0], at + 1) < 0 && inChildren && !words.some((w) => w.word === m[0])) {
                    words.push({ node: n, offset: m.index!, word: m[0] });
                    break;
                }
            }
        }
        for (const w of words) {
            view.dispatch({
                selection: { anchor: away(line) },
                effects: EditorView.scrollIntoView(el.from, { y: 'center' }),
            });
            await frame();
            const target = [...view.contentDOM.querySelectorAll<HTMLElement>('.mdx-render')].find(
                (d) => view.posAtDOM(d) === from
            );
            const node = target && findText(target, w.word);
            if (!node) continue;
            const range = document.createRange();
            range.setStart(node.node, node.offset);
            range.setEnd(node.node, node.offset + 1);
            const r = range.getBoundingClientRect();
            const got = await click(view, r.left + 1, (r.top + r.bottom) / 2);
            const expected = el.from + source.indexOf(w.word);
            checks++;
            if (got !== expected) {
                failures.push({
                    case: `rendered ${el.name}: “${w.word}”`,
                    line,
                    expected,
                    got,
                    context: view.state.sliceDoc(Math.max(0, got - 12), got + 12),
                });
            }
        }
    }
    return { checks, failures };
}

function findText(root: HTMLElement, word: string) {
    const walker = document.createTreeWalker(root.querySelector('.mdx-html') ?? root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        const i = n.data.search(new RegExp(`\\b${word}\\b`));
        if (i >= 0) return { node: n, offset: i };
    }
    return null;
}

/** Run the test with a small progress/result panel, and expose the result as `window.mdxEditorSelfTest`. */
export async function selfTestPanel(view: EditorView) {
    const panel = h('div', { class: 'mdx-editor-selftest', role: 'status' }, 'Click test: starting…');
    document.body.append(panel);
    const result = await runSelfTest(view, (done, total) => {
        panel.textContent = `Click test: ${done}/${total} lines…`;
    });
    Object.assign(window, { mdxEditorSelfTest: result });
    panel.replaceChildren(
        h(
            'strong',
            {},
            `Click test: ${result.checks - result.failures.length}/${result.checks} landed exactly ` +
                `(${result.renderedChecks} in rendered components)`
        ),
        ...result.failures
            .slice(0, 12)
            .map((f) =>
                h(
                    'div',
                    {},
                    `line ${f.line} (${f.case}): expected ${f.expected}, got ${f.got} (${f.got - f.expected}) “${f.context}”`
                )
            )
    );
    panel.dataset.result = result.failures.length ? 'fail' : 'pass';
    return result;
}
