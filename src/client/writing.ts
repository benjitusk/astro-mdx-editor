import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import type { Api } from './api.ts';
import { h } from './dom.ts';
import { allElements, jsxField } from './jsx.ts';
import { inMeta, metaField } from './meta.ts';
import { openPicker } from './picker.ts';

/**
 * Writing aids: a live word count and reading time (prose only), a heading outline to jump through,
 * a focus mode that dims everything but the block being written, and quick open for other entries.
 */

// ---------- word count ----------

/** Node types whose text isn't prose. */
const NOT_PROSE = new Set([
    'FencedCode',
    'CodeBlock',
    'InlineCode',
    'HTMLBlock',
    'HTMLTag',
    'MdxTag',
    'Comment',
    'CommentBlock',
    'URL',
    'LinkMark',
    'EmphasisMark',
    'HeaderMark',
    'QuoteMark',
    'ListMark',
    'TaskMarker',
    'CodeMark',
    'TableDelimiter',
]);

const WORD = /[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu;

/** Words in [from, to) of prose: no frontmatter, imports, tags, props, code or Markdown markers. */
export function countWords(state: EditorState, from = 0, to = state.doc.length): number {
    const skip: [number, number][] = [];
    const meta = state.field(metaField);
    if (meta.frontmatter) skip.push([meta.frontmatter.from, meta.frontmatter.to]);
    for (const s of meta.esm) skip.push([s.from, s.to]);
    for (const el of allElements(state.field(jsxField, false) ?? [])) {
        if (el.kind === 'void') skip.push([el.from, el.to]);
        else {
            skip.push([el.from, el.openTo]);
            skip.push([el.closeFrom, el.to]);
        }
    }
    const tree = ensureSyntaxTree(state, to, 200) ?? syntaxTree(state);
    tree.iterate({
        from,
        to,
        enter: (n) => {
            if (!NOT_PROSE.has(n.name)) return;
            skip.push([n.from, n.to]);
            return false;
        },
    });
    skip.sort((a, b) => a[0] - b[0]);
    let words = 0;
    let pos = from;
    const count = (a: number, b: number) => {
        if (b > a) words += state.sliceDoc(a, b).match(WORD)?.length ?? 0;
    };
    for (const [a, b] of skip) {
        if (b <= pos) continue;
        count(pos, Math.min(a, to));
        pos = Math.max(pos, b);
        if (pos >= to) break;
    }
    count(pos, to);
    return words;
}

const WORDS_PER_MINUTE = 230;

/** "1,234 words · 6 min", or "12 of 1,234 words" with a selection. */
export function countLabel(state: EditorState): string {
    const total = countWords(state);
    const fmt = (n: number) => n.toLocaleString('en');
    const sel = state.selection.main;
    if (!sel.empty) return `${fmt(countWords(state, sel.from, sel.to))} of ${fmt(total)} words`;
    return `${fmt(total)} words · ${Math.max(1, Math.round(total / WORDS_PER_MINUTE))} min`;
}

export const wordCount = ViewPlugin.fromClass(
    class {
        el = h('div', { class: 'mdx-editor-count', role: 'status' });
        timer: ReturnType<typeof setTimeout> | undefined;
        view: EditorView;
        constructor(view: EditorView) {
            this.view = view;
            document.body.append(this.el);
            this.el.textContent = countLabel(view.state);
        }
        update(u: ViewUpdate) {
            if (!u.docChanged && !u.selectionSet) return;
            clearTimeout(this.timer);
            this.timer = setTimeout(() => (this.el.textContent = countLabel(this.view.state)), 250);
        }
        destroy() {
            clearTimeout(this.timer);
            this.el.remove();
        }
    }
);

// ---------- outline ----------

export interface Heading {
    level: number;
    text: string;
    /** Where its text starts. */
    pos: number;
}

export function headings(state: EditorState): Heading[] {
    const out: Heading[] = [];
    const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
    const meta = state.field(metaField);
    tree.iterate({
        enter: (n) => {
            const m = /^(?:ATXHeading|SetextHeading)(\d)$/.exec(n.name);
            if (!m) return;
            // The frontmatter's closing `---` reads as a setext underline.
            if (inMeta(meta, n.from)) return false;
            const mark = n.node.getChild('HeaderMark');
            const pos = mark && mark.from === n.from ? Math.min(mark.to + 1, n.to) : n.from;
            const text = state
                .sliceDoc(pos, n.to)
                .replace(/\n[=-]+\s*$/, '')
                .replace(/\s#+\s*$/, '')
                .trim();
            if (text) out.push({ level: Number(m[1]), text, pos });
            return false;
        },
    });
    return out;
}

export function openOutline(view: EditorView): boolean {
    const list = headings(view.state);
    if (!list.length) return false;
    const head = view.state.selection.main.head;
    openPicker(view, {
        placeholder: 'Jump to heading…',
        items: list,
        initial: list.filter((x) => x.pos <= head).at(-1),
        text: (x) => x.text,
        row: (x) => [h('span', { style: `padding-left: ${(x.level - 1) * 1}rem` }, x.text)],
        onPick: (x) => {
            view.dispatch({
                selection: { anchor: x.pos },
                effects: EditorView.scrollIntoView(x.pos, { y: 'start', yMargin: 80 }),
            });
            view.focus();
        },
    });
    return true;
}

// ---------- focus mode ----------

const setFocus = StateEffect.define<boolean>();
const focusOn = StateField.define<boolean>({
    create: () => false,
    update: (on, tr) => tr.effects.reduce((v, e) => (e.is(setFocus) ? e.value : v), on),
    provide: (f) =>
        EditorView.editorAttributes.from(f, (on) => (on ? { class: 'mdx-focus' } : ({} as Record<string, string>))),
});

const BLOCKS = /^(Paragraph|ATXHeading\d|SetextHeading\d|FencedCode|Table|HTMLBlock|Blockquote|ListItem)$/;

/** The block being written: the innermost paragraph, heading, code block… around the cursor. */
export function currentBlock(state: EditorState): { from: number; to: number } {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    let n: SyntaxNode | null = syntaxTree(state).resolveInner(head, -1);
    for (; n; n = n.parent) if (BLOCKS.test(n.name) && n.from <= head && n.to >= head) break;
    return n ? { from: n.from, to: n.to } : { from: line.from, to: line.to };
}

const focused = Decoration.line({ class: 'md-focus-on' });

const focusLines = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet = Decoration.none;
        constructor(view: EditorView) {
            this.decorations = this.build(view.state);
        }
        update(u: ViewUpdate) {
            if (u.docChanged || u.selectionSet || u.startState.field(focusOn) !== u.state.field(focusOn))
                this.decorations = this.build(u.state);
        }
        build(state: EditorState): DecorationSet {
            if (!state.field(focusOn)) return Decoration.none;
            const { from, to } = currentBlock(state);
            const out: Range<Decoration>[] = [];
            for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++)
                out.push(focused.range(state.doc.line(n).from));
            return Decoration.set(out);
        }
    },
    { decorations: (p) => p.decorations }
);

export function toggleFocus(view: EditorView): boolean {
    view.dispatch({ effects: setFocus.of(!view.state.field(focusOn)) });
    return true;
}

// ---------- quick open ----------

export function quickOpen(api: Api, current: { collection: string; id: string }) {
    return (view: EditorView): boolean => {
        void api.entries().then((entries) => {
            const others = entries.filter((e) => e.collection !== current.collection || e.id !== current.id);
            openPicker(view, {
                placeholder: 'Open entry…',
                items: others,
                text: (e) => `${e.collection}/${e.id}`,
                row: (e) => [h('b', {}, e.id), ' ', h('small', {}, e.collection)],
                onPick: (e) => location.assign(`/__edit/${e.collection}/${e.id}`),
            });
        });
        return true;
    };
}

export const writingExtensions = [wordCount, focusOn, focusLines];
