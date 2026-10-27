import { EditorView } from '@codemirror/view';
import { h } from './dom.ts';
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
    view.dispatch({ selection: initial });
    return { checks, failures };
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
        h('strong', {}, `Click test: ${result.checks - result.failures.length}/${result.checks} landed exactly`),
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
