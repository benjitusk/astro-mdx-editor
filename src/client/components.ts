import {
    Prec,
    RangeSet,
    StateEffect,
    StateField,
    type EditorState,
    type Extension,
    type Range,
} from '@codemirror/state';
import {
    Decoration,
    EditorView,
    keymap,
    ViewPlugin,
    WidgetType,
    type DecorationSet,
    type ViewUpdate,
} from '@codemirror/view';
import type { Api } from './api.ts';
import { h } from './dom.ts';
import { allElements, elementAt, jsxField, type JsxElement } from './jsx.ts';
import { prefix, prefixSource, type Prefix } from './livepreview.ts';
import { caretPoint, renderedText, sourceOffsetFor } from './textmap.ts';

/**
 * Components in "mode A" (docs/DECISIONS.md, 3):
 * - cursor elsewhere: the element is replaced by its real render (from the site's MDX pipeline);
 * - cursor inside a block: the tags shrink to a props chip and the children are live-preview text in
 *   a frame (nested components inside it follow the same rules);
 * - `</>` (or Cmd-Enter) shows the element as raw MDX until the cursor leaves it, as does moving the
 *   cursor into the tag itself.
 * The text is never changed to achieve any of this.
 */

// ---------- render results ----------

export interface RenderResult {
    html?: string;
    error?: string;
}

const renderDone = StateEffect.define<{ key: string; result: RenderResult }>();

/** FNV-1a: a cheap key for an element's source (the server hashes properly). */
function keyOf(source: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < source.length; i++) h = Math.imul(h ^ source.charCodeAt(i), 0x01000193);
    return `${(h >>> 0).toString(36)}-${source.length}`;
}

interface Renders {
    results: Map<string, RenderResult>;
    /** The last good render at each element position, shown while a changed element re-renders. */
    stale: Map<number, string>;
}

const renders = StateField.define<Renders>({
    create: () => ({ results: new Map(), stale: new Map() }),
    update(value, tr) {
        let { results, stale } = value;
        if (tr.docChanged) {
            const mapped = new Map<number, string>();
            for (const [pos, html] of stale) mapped.set(tr.changes.mapPos(pos), html);
            stale = mapped;
        }
        const done = tr.effects.filter((e) => e.is(renderDone));
        if (done.length) {
            results = new Map(results);
            for (const e of done) results.set(e.value.key, e.value.result);
        }
        if (done.length || tr.docChanged) {
            stale = new Map(stale);
            for (const el of allElements(tr.state.field(jsxField))) {
                const html = results.get(keyOf(tr.state.sliceDoc(el.from, el.to)))?.html;
                if (html !== undefined) stale.set(el.from, html);
            }
        }
        return results === value.results && stale === value.stale ? value : { results, stale };
    },
});

// ---------- raw (</>) state ----------

const toggleRaw = StateEffect.define<number>();

/** Elements shown as raw MDX (by start position). An element leaves raw mode when the cursor leaves it. */
const rawOpen = StateField.define<number[]>({
    create: () => [],
    update(value, tr) {
        let out = tr.docChanged ? value.map((p) => tr.changes.mapPos(p)) : value;
        for (const e of tr.effects) {
            if (!e.is(toggleRaw)) continue;
            out = out.includes(e.value) ? out.filter((p) => p !== e.value) : [...out, e.value];
        }
        if (out.length && (tr.selection || tr.docChanged)) {
            const els = [...allElements(tr.state.field(jsxField))];
            const head = tr.state.selection.main.head;
            out = out.filter((p) => {
                const el = els.find((e) => e.from === p);
                return el && head >= el.from && head <= el.to;
            });
        }
        return out;
    },
});

// ---------- geometry ----------

export function blockRange(state: EditorState, el: JsxElement) {
    return { from: state.doc.lineAt(el.from).from, to: state.doc.lineAt(el.to).to };
}

/** Where typing starts in a block's children: the first child line, after its indentation. */
function contentStart(state: EditorState, el: JsxElement) {
    const line = state.doc.lineAt(el.innerFrom);
    return Math.min(line.from + el.childIndent, line.to);
}

function headInside(state: EditorState, el: JsxElement) {
    const { from, to } = el.kind === 'inline' ? el : blockRange(state, el);
    return (
        state.selection.ranges.some((r) => r.head > from && r.head < to) || (el.kind === 'inline' && touches(state, el))
    );
}

function touches(state: EditorState, el: JsxElement) {
    return state.selection.ranges.some((r) => r.from <= el.to && r.to >= el.from);
}

const hasChildren = (el: JsxElement) => el.innerFrom < el.innerTo;

// ---------- widgets ----------

interface WidgetContext {
    el: JsxElement;
    key: string;
    html: string | null;
    stale: boolean;
    error: string | null;
    depth: number;
}

function preventLinks(dom: HTMLElement) {
    dom.addEventListener('click', (e) => {
        if ((e.target as Element).closest('a')) e.preventDefault();
    });
}

/** Enter an element from a click on its render: find the clicked text in the source. */
function enterFromClick(view: EditorView, el: JsxElement, dom: HTMLElement, e: MouseEvent) {
    const { state } = view;
    const point = caretPoint(e.clientX, e.clientY);
    const htmlRoot = dom.querySelector('.mdx-html') ?? dom;
    const { text, at } = renderedText(htmlRoot, point && htmlRoot.contains(point.node) ? point : null);
    const source = state.sliceDoc(el.from, el.to);
    const offset = at >= 0 ? sourceOffsetFor(source, text, at) : null;
    let pos = offset === null ? null : el.from + offset;
    const inChildren = pos !== null && pos >= el.innerFrom && pos <= el.innerTo;
    if ((el.kind === 'block' || el.kind === 'line') && hasChildren(el)) {
        if (pos !== null && !inChildren) {
            // The text is a prop value: show the tag and put the cursor there.
            view.dispatch({ effects: toggleRaw.of(el.from), selection: { anchor: pos }, userEvent: 'select.pointer' });
            return;
        }
        if (pos === null) pos = el.kind === 'block' ? contentStart(state, el) : el.innerFrom;
        view.dispatch({ selection: { anchor: pos }, userEvent: 'select.pointer' });
        return;
    }
    // Self-closing or empty: edit as raw MDX.
    view.dispatch({ effects: toggleRaw.of(el.from), selection: { anchor: pos ?? el.from + 1 + el.name.length } });
}

function rawButton(view: EditorView, el: JsxElement) {
    return h(
        'button',
        {
            'class': 'mdx-raw-toggle',
            'title': 'Show MDX source (Cmd-Enter)',
            'aria-label': 'Show MDX source',
            'onmousedown': (e: Event) => {
                e.preventDefault();
                e.stopPropagation();
                const at = Math.min(el.from + 1 + el.name.length, el.openTo);
                view.dispatch({ effects: toggleRaw.of(el.from), selection: { anchor: at } });
                view.focus();
            },
        },
        '</>'
    );
}

class RenderedWidget extends WidgetType {
    ctx: WidgetContext;
    constructor(ctx: WidgetContext) {
        super();
        this.ctx = ctx;
    }
    eq(other: RenderedWidget) {
        const a = this.ctx;
        const b = other.ctx;
        return (
            a.key === b.key && a.html === b.html && a.error === b.error && a.stale === b.stale && a.depth === b.depth
        );
    }
    toDOM(view: EditorView) {
        const { el, html, stale, error, depth } = this.ctx;
        const inline = el.kind === 'inline';
        const dom = h(inline ? 'span' : 'div', {
            'class': `mdx-render mdx-render-${el.kind}${depth && !inline ? ' mdx-in-frame' : ''}${stale ? ' mdx-stale' : ''}${error ? ' mdx-error' : ''}`,
            'data-component': el.name,
            'style': depth ? `--frame-depth: ${depth}` : undefined,
        });
        const body = h(inline ? 'span' : 'div', { class: 'mdx-html' });
        if (html !== null) body.innerHTML = inline ? html.replace(/^<p>([\s\S]*)<\/p>\s*$/, '$1') : html;
        else body.append(h('code', { class: 'mdx-pending' }, view.state.sliceDoc(el.from, el.to)));
        dom.append(body);
        if (!inline) dom.append(rawButton(view, el));
        if (error)
            dom.append(h('span', { class: 'mdx-error-badge', title: error }, `${el.name} didn’t render: ${error}`));
        preventLinks(dom);
        dom.addEventListener('mousedown', (event) => {
            const e = event as MouseEvent;
            if (e.button !== 0) return;
            e.preventDefault();
            enterFromClick(view, el, dom, e);
            view.focus();
        });
        return dom;
    }
    ignoreEvent() {
        return true;
    }
}

function chip(view: EditorView, el: JsxElement) {
    const props = el.props.map((p) =>
        h(
            'span',
            { class: 'mdx-prop' },
            p.name ? h('i', {}, p.name) : null,
            p.name ? ' ' : null,
            p.value ?? p.raw ?? '✓'
        )
    );
    return h(
        'span',
        {
            class: 'mdx-chip',
            title: 'Edit the tag as MDX',
            onmousedown: (e: Event) => {
                e.preventDefault();
                view.dispatch({ effects: toggleRaw.of(el.from), selection: { anchor: el.from + 1 + el.name.length } });
                view.focus();
            },
        },
        h('b', {}, el.name),
        ...props
    );
}

class FrameTop extends WidgetType {
    el: JsxElement;
    depth: number;
    constructor(el: JsxElement, depth: number) {
        super();
        this.el = el;
        this.depth = depth;
    }
    eq(o: FrameTop) {
        return (
            o.el.from === this.el.from &&
            o.depth === this.depth &&
            JSON.stringify(o.el.props) === JSON.stringify(this.el.props)
        );
    }
    toDOM(view: EditorView) {
        return h(
            'div',
            { class: 'mdx-frame-top', style: `--frame-depth: ${this.depth}` },
            chip(view, this.el),
            rawButton(view, this.el)
        );
    }
    ignoreEvent() {
        return true;
    }
}

class FrameBottom extends WidgetType {
    depth: number;
    constructor(depth: number) {
        super();
        this.depth = depth;
    }
    eq(o: FrameBottom) {
        return o.depth === this.depth;
    }
    toDOM() {
        return h('div', { class: 'mdx-frame-bottom', style: `--frame-depth: ${this.depth}` });
    }
}

class LineChip extends WidgetType {
    el: JsxElement;
    constructor(el: JsxElement) {
        super();
        this.el = el;
    }
    eq(o: LineChip) {
        return o.el.from === this.el.from && JSON.stringify(o.el.props) === JSON.stringify(this.el.props);
    }
    toDOM(view: EditorView) {
        return chip(view, this.el);
    }
    ignoreEvent() {
        return true;
    }
}

// ---------- decorations ----------

interface Components {
    decorations: DecorationSet;
    atomic: RangeSet<Decoration>;
    prefixes: RangeSet<Prefix>;
    /** Elements shown rendered, with their render keys, for the requester. */
    wanted: { key: string; source: string }[];
    /** Innermost-first chain of block elements the cursor is in (framed). */
    entered: JsxElement[];
}

function build(state: EditorState): Components {
    const out: Range<Decoration>[] = [];
    const atomic: Range<Decoration>[] = [];
    const prefixes: Range<Prefix>[] = [];
    const wanted: Components['wanted'] = [];
    const entered: JsxElement[] = [];
    const raw = state.field(rawOpen);
    const { results, stale } = state.field(renders);

    const render = (el: JsxElement, depth: number) => {
        const source = state.sliceDoc(el.from, el.to);
        const key = keyOf(source);
        const result = results.get(key);
        if (!result) wanted.push({ key, source });
        const html = result?.html ?? stale.get(el.from) ?? null;
        const ctx: WidgetContext = {
            el,
            key,
            html,
            stale: !result?.html && html !== null,
            error: result?.error ?? null,
            depth,
        };
        if (el.kind === 'inline') {
            if (html === null) return; // stays raw until its render arrives
            const d = Decoration.replace({ widget: new RenderedWidget(ctx) });
            out.push(d.range(el.from, el.to));
            atomic.push(d.range(el.from, el.to));
            return;
        }
        const { from, to } = blockRange(state, el);
        const d = Decoration.replace({ widget: new RenderedWidget(ctx), block: true });
        out.push(d.range(from, to));
        atomic.push(d.range(from, to));
    };

    const walk = (els: JsxElement[], depth: number) => {
        for (const el of els) {
            const inside = headInside(state, el);
            if (!inside) {
                render(el, depth);
                continue;
            }
            if (raw.includes(el.from)) continue;
            const head = state.selection.main.head;
            if (el.kind === 'line' && hasChildren(el)) {
                if (head < el.openTo || head > el.closeFrom) continue; // in a tag: raw
                const line = state.doc.lineAt(el.from);
                out.push(
                    Decoration.line({
                        class: 'mdx-frame mdx-frame-single',
                        attributes: { style: `--frame-depth: ${depth + 1}` },
                    }).range(line.from)
                );
                out.push(Decoration.replace({ widget: new LineChip(el) }).range(el.from, el.openTo));
                out.push(Decoration.replace({}).range(el.closeFrom, el.to));
                prefixes.push(prefix.range(el.from, el.openTo));
                entered.unshift(el);
                walk(el.children, depth + 1);
                continue;
            }
            if (el.kind !== 'block' || !hasChildren(el)) continue; // void, empty, inline: raw while inside
            if (head < el.innerFrom || head > el.innerTo) continue; // in a tag line: raw
            const { from, to } = blockRange(state, el);
            const top = Decoration.replace({ widget: new FrameTop(el, depth + 1), block: true });
            const bottom = Decoration.replace({ widget: new FrameBottom(depth + 1), block: true });
            out.push(top.range(from, el.innerFrom - 1), bottom.range(el.innerTo + 1, to));
            atomic.push(top.range(from, el.innerFrom - 1), bottom.range(el.innerTo + 1, to));
            const first = state.doc.lineAt(el.innerFrom).number;
            const last = state.doc.lineAt(el.innerTo).number;
            for (let n = first; n <= last; n++) {
                const line = state.doc.line(n);
                const cls = `mdx-frame${n === first ? ' mdx-frame-first' : ''}${n === last ? ' mdx-frame-last' : ''}`;
                out.push(
                    Decoration.line({ class: cls, attributes: { style: `--frame-depth: ${depth + 1}` } }).range(
                        line.from
                    )
                );
                // Show indented children dedented (the indentation stays in the file).
                const indent = Math.min(el.childIndent, /^[ \t]*/.exec(line.text)![0].length);
                if (indent) {
                    out.push(Decoration.replace({}).range(line.from, line.from + indent));
                    prefixes.push(prefix.range(line.from, line.from + indent));
                }
            }
            entered.unshift(el);
            walk(el.children, depth + 1);
        }
    };
    walk(state.field(jsxField), 0);

    return {
        decorations: Decoration.set(out, true),
        atomic: Decoration.set(atomic, true),
        prefixes: RangeSet.of(prefixes, true),
        wanted,
        entered,
    };
}

export const components = StateField.define<Components>({
    create: build,
    update: (value, tr) => (tr.docChanged || tr.selection || tr.effects.length ? build(tr.state) : value),
    provide: (f) => [
        EditorView.decorations.from(f, (v) => v.decorations),
        EditorView.atomicRanges.of((view) => view.state.field(f).atomic),
        prefixSource.of((state) => state.field(f).prefixes),
    ],
});

// ---------- fetching renders ----------

function requester(api: Api) {
    return ViewPlugin.fromClass(
        class {
            inflight = new Set<string>();
            timer: ReturnType<typeof setTimeout> | undefined;
            view: EditorView;
            constructor(view: EditorView) {
                this.view = view;
                this.schedule(0);
            }
            update(u: ViewUpdate) {
                if (u.docChanged || u.selectionSet || u.transactions.some((t) => t.effects.length)) this.schedule(150);
            }
            schedule(ms: number) {
                clearTimeout(this.timer);
                this.timer = setTimeout(() => this.fetch(), ms);
            }
            fetch() {
                for (const { key, source } of this.view.state.field(components).wanted) {
                    if (this.inflight.has(key)) continue;
                    this.inflight.add(key);
                    api.render(source)
                        .then((result) => this.view.dispatch({ effects: renderDone.of({ key, result }) }))
                        .catch((e) =>
                            this.view.dispatch({ effects: renderDone.of({ key, result: { error: String(e) } }) })
                        )
                        .finally(() => this.inflight.delete(key));
                }
            }
            destroy() {
                clearTimeout(this.timer);
            }
        }
    );
}

// ---------- keyboard ----------

function innermostEntered(state: EditorState) {
    return state.field(components).entered[0] ?? null;
}

/** Arrow keys step into a rendered block's children, and out of a frame past its closing tag. */
function arrow(down: boolean) {
    return (view: EditorView): boolean => {
        const { state } = view;
        const sel = state.selection.main;
        if (!sel.empty || state.selection.ranges.length > 1) return false;
        const line = state.doc.lineAt(sel.head);
        // Into a rendered block or one-line element right above or below the cursor's line.
        for (const target of allElements(state.field(jsxField))) {
            if (target.kind === 'inline' || target.kind === 'void' || !hasChildren(target)) continue;
            if (headInside(state, target)) continue;
            const r = blockRange(state, target);
            if (down ? line.to + 1 !== r.from : line.from - 1 !== r.to) continue;
            const anchor =
                target.kind === 'line'
                    ? down
                        ? target.innerFrom
                        : target.innerTo
                    : down
                      ? contentStart(state, target)
                      : target.innerTo;
            view.dispatch({ selection: { anchor }, scrollIntoView: true });
            return true;
        }
        // Out of the innermost frame when the move would leave its children.
        const el = innermostEntered(state);
        if (!el) return false;
        const next = view.moveVertically(sel, down);
        if (el.kind === 'line') return next.head < el.from || next.head > el.to ? exitBlock(view, el, down) : false;
        if ((down && next.head > el.innerTo) || (!down && next.head < el.innerFrom)) return exitBlock(view, el, down);
        return false;
    };
}

function exitBlock(view: EditorView, el: JsxElement, down: boolean) {
    const { state } = view;
    const r = blockRange(state, el);
    const anchor = down ? Math.min(r.to + 1, state.doc.length) : Math.max(r.from - 1, 0);
    view.dispatch({ selection: { anchor }, scrollIntoView: true });
    return true;
}

/** Backspace/Delete can't merge a block's children into its tag lines (MDX needs them apart). */
function guard(backward: boolean) {
    return (view: EditorView): boolean => {
        const { state } = view;
        const sel = state.selection.main;
        if (!sel.empty) return false;
        const el = innermostEntered(state);
        if (!el) return false;
        if (el.kind === 'line') return backward ? sel.head === el.innerFrom : sel.head === el.innerTo;
        const start = state.doc.lineAt(el.innerFrom);
        return backward ? sel.head >= start.from && sel.head <= contentStart(state, el) : sel.head === el.innerTo;
    };
}

function toggleRawAtCursor(view: EditorView): boolean {
    const { state } = view;
    const el = elementAt(state.field(jsxField), state.selection.main.head);
    if (!el) return false;
    view.dispatch({ effects: toggleRaw.of(el.from) });
    return true;
}

function leave(view: EditorView): boolean {
    const el = innermostEntered(view.state);
    return el ? exitBlock(view, el, true) : false;
}

export const componentCommands = {
    toggleRaw: toggleRawAtCursor,
    leave,
};

export function componentExtensions(api: Api): Extension {
    return [
        renders,
        rawOpen,
        components,
        requester(api),
        Prec.highest(
            keymap.of([
                { key: 'ArrowDown', run: arrow(true) },
                { key: 'ArrowUp', run: arrow(false) },
                { key: 'Backspace', run: guard(true) },
                { key: 'Delete', run: guard(false) },
            ])
        ),
    ];
}

/** For the click test: the element under a document position and whether it's rendered. */
export function renderedAt(state: EditorState, pos: number) {
    let hit = false;
    state.field(components).atomic.between(pos, pos, (from, to) => {
        if (pos >= from && pos < to) hit = true;
    });
    return hit;
}
