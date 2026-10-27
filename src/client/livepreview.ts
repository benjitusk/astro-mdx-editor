import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import {
    EditorSelection,
    EditorState,
    Facet,
    RangeSet,
    RangeValue,
    StateField,
    type Range,
    type Text,
} from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { metaField, type Meta } from './meta.ts';

/**
 * Obsidian-style live preview, as decorations over the raw text (the text itself is never changed).
 *
 * - Inline marks become real elements (`em`, `strong`, `code`, `s`, `a`, `h2`…), so the site's own Prose
 *   CSS styles them. Their markers (`_`, `**`, `[`, `](url)`) hide unless the selection touches the node.
 * - Block markers (`##`, `>`, list markers, list indentation) never sit inline: hidden, they take no
 *   space; revealed, they hang in the left margin. Text never moves when the cursor arrives, so clicks
 *   land where the user aimed (see docs/DECISIONS.md, 5).
 * - Line classes reproduce Prose's block spacing, which can't reach through CodeMirror's DOM.
 */

/** Ranges hidden at the start of a line; a click landing on one is moved past it (see leanToContent). */
export class Prefix extends RangeValue {}
export const prefix = new Prefix();

/** Sources of prefix ranges (live preview, component frames). */
export const prefixSource = Facet.define<(state: EditorState) => RangeSet<Prefix>>();

export interface Preview {
    decorations: DecorationSet;
    prefixes: RangeSet<Prefix>;
}

const hidden = Decoration.replace({});
const hang = Decoration.mark({ class: 'md-mark md-hang' });
const markerShown = Decoration.mark({ class: 'md-mark' });
const line = (cls: string, attributes?: Record<string, string>) => Decoration.line({ class: cls, attributes });
const tag = (tagName: string, cls: string, attributes?: Record<string, string>) =>
    Decoration.mark({ tagName, class: cls, attributes });

class RuleWidget extends WidgetType {
    eq() {
        return true;
    }
    toDOM() {
        const el = document.createElement('span');
        el.className = 'md-hr';
        el.setAttribute('aria-label', 'Section break');
        return el;
    }
}
const rule = Decoration.replace({ widget: new RuleWidget() });

const INLINE: Record<string, { tagName: string; cls: string; marks: string[] }> = {
    Emphasis: { tagName: 'em', cls: 'md-em', marks: ['EmphasisMark'] },
    StrongEmphasis: { tagName: 'strong', cls: 'md-strong', marks: ['EmphasisMark'] },
    InlineCode: { tagName: 'code', cls: 'md-code-inline', marks: ['CodeMark'] },
    Strikethrough: { tagName: 's', cls: 'md-strike', marks: ['StrikethroughMark'] },
};

const LIST_INDENT_REM = 1.5;

function build(state: EditorState): Preview {
    const doc = state.doc;
    const meta = state.field(metaField);
    const tree = ensureSyntaxTree(state, doc.length, 200) ?? syntaxTree(state);
    const out: Range<Decoration>[] = [];
    const prefixes: Range<Prefix>[] = [];
    const ranges = state.selection.ranges;
    const touches = (from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from);
    const lineTouched = (n: number) => {
        const l = doc.line(n);
        return touches(l.from, l.to);
    };
    const hide = (from: number, to: number, isPrefix = false) => {
        if (to <= from) return;
        out.push(hidden.range(from, to));
        if (isPrefix) prefixes.push(prefix.range(from, to));
    };
    const inMetaSpan = (pos: number) => metaSpans(meta).some((s) => pos >= s.from && pos <= s.to);

    // Frontmatter and ESM: shown raw, quietly.
    for (const span of metaSpans(meta)) {
        const first = doc.lineAt(span.from).number;
        const last = doc.lineAt(span.to).number;
        for (let n = first; n <= last; n++) {
            out.push(
                line(`md-meta${n === first ? ' md-meta-first' : ''}${n === last ? ' md-meta-last' : ''}`).range(
                    doc.line(n).from
                )
            );
        }
    }

    const blockLines = new Map<number, string[]>();
    const addLineClass = (n: number, cls: string) => {
        const list = blockLines.get(n) ?? [];
        list.push(cls);
        blockLines.set(n, list);
    };
    const lineStyles = new Map<number, string>();

    tree.iterate({
        enter: (ref) => {
            const node = ref.node;
            if (node.name === 'Document') return;
            if (inMetaSpan(node.from)) return false;
            const name = node.name;

            const heading = /^ATXHeading(\d)$/.exec(name);
            if (heading) {
                const level = Number(heading[1]);
                const l = doc.lineAt(node.from);
                addLineClass(l.number, `md-h md-h${level}`);
                const mark = node.getChild('HeaderMark');
                if (mark) {
                    const end = Math.min(mark.to + 1, node.to);
                    if (lineTouched(l.number)) out.push(hang.range(mark.from, end));
                    else hide(mark.from, end, true);
                    if (end < node.to) out.push(tag(`h${level}`, 'md-heading').range(end, node.to));
                }
                return;
            }

            if (name === 'Blockquote') {
                const first = doc.lineAt(node.from).number;
                const last = doc.lineAt(node.to).number;
                const active = touches(node.from, node.to);
                for (let n = first; n <= last; n++) {
                    addLineClass(n, `md-bq${n === first ? ' md-bq-first' : ''}${n === last ? ' md-bq-last' : ''}`);
                }
                for (const qm of childrenNamed(node, 'QuoteMark', true)) {
                    const after = doc.sliceString(qm.to, qm.to + 1) === ' ' ? qm.to + 1 : qm.to;
                    const start = doc.lineAt(qm.from).from;
                    if (active) out.push(hang.range(start, after));
                    else hide(start, after, true);
                }
                return;
            }

            if (name === 'ListItem') {
                const depth = listDepth(node);
                const listMark = node.getChild('ListMark');
                const first = doc.lineAt(node.from).number;
                const last = doc.lineAt(node.to).number;
                const ordered = node.parent?.name === 'OrderedList';
                const notFirstItem = node.prevSibling?.name === 'ListItem';
                for (let n = first; n <= last; n++) {
                    const l = doc.line(n);
                    if (!l.text.trim()) continue;
                    const indent = /^\s*/.exec(l.text)![0].length;
                    // A line inside a nested list belongs to the deepest item; let that item style it.
                    if (n > first && owningItem(tree.resolveInner(l.from + indent, 1))?.from !== node.from) continue;
                    addLineClass(n, `md-li${n === first && notFirstItem ? ' md-li-gap' : ''}`);
                    lineStyles.set(n, `--md-indent: ${depth * LIST_INDENT_REM}rem`);
                    if (n === first && listMark) {
                        hide(l.from, listMark.from, true);
                        const end = Math.min(listMark.to + 1, l.to);
                        const cls = ordered ? 'md-listmark md-ol' : 'md-listmark md-ul';
                        const attributes = lineTouched(n) ? { 'data-shown': '' } : undefined;
                        out.push(Decoration.mark({ class: cls, attributes }).range(listMark.from, end));
                        // The marker hangs in the margin; a click beside it means the text.
                        prefixes.push(prefix.range(listMark.from, end));
                    } else hide(l.from, l.from + indent, true);
                }
                return;
            }

            if (name === 'FencedCode') {
                const first = doc.lineAt(node.from).number;
                const last = doc.lineAt(node.to).number;
                for (let n = first; n <= last; n++) {
                    addLineClass(
                        n,
                        `md-fence${n === first ? ' md-fence-first' : ''}${n === last ? ' md-fence-last' : ''}`
                    );
                }
                for (const m of childrenNamed(node, 'CodeMark')) out.push(markerShown.range(m.from, m.to));
                const info = node.getChild('CodeInfo');
                if (info) out.push(markerShown.range(info.from, info.to));
                return false;
            }

            if (name === 'HorizontalRule') {
                const l = doc.lineAt(node.from);
                if (lineTouched(l.number)) out.push(markerShown.range(node.from, node.to));
                else out.push(rule.range(node.from, node.to));
                return false;
            }

            if (name === 'HTMLBlock') {
                // Lezer runs an HTML block on to the next blank line, but in MDX the text after a
                // component's opening tag is Markdown: only lines that are tags get the raw style.
                const first = doc.lineAt(node.from).number;
                const last = doc.lineAt(node.to).number;
                for (let n = first; n <= last; n++) {
                    const l = doc.line(n);
                    if (!/^\s*</.test(l.text)) continue;
                    addLineClass(n, 'md-jsx');
                    jsxTokens(doc, l.from, l.to, out);
                }
                return false;
            }
            if (name === 'HTMLTag') {
                jsxTokens(doc, node.from, node.to, out);
                return false;
            }
            if (name === 'Comment' || name === 'CommentBlock') {
                out.push(Decoration.mark({ class: 'md-comment' }).range(node.from, node.to));
                return false;
            }

            const inline = INLINE[name];
            if (inline) {
                const active = touches(node.from, node.to);
                out.push(tag(inline.tagName, inline.cls).range(node.from, node.to));
                for (const m of childrenNamed(node, inline.marks[0])) {
                    if (active) out.push(markerShown.range(m.from, m.to));
                    else hide(m.from, m.to);
                }
                return;
            }

            if (name === 'Link') {
                // `[!type]` at the start of a quote is a callout marker, not a link (styled in phase 3).
                if (/^\[!\w+\]/.test(doc.sliceString(node.from, node.to)) && node.parent?.name === 'Paragraph')
                    return false;
                const marks = childrenNamed(node, 'LinkMark');
                const url = node.getChild('URL');
                const close = marks.find((m) => doc.sliceString(m.from, m.to) === ']');
                if (!close || marks.length < 2) return;
                const active = touches(node.from, node.to);
                const href = url ? doc.sliceString(url.from, url.to) : '';
                out.push(tag('a', 'md-link', href ? { title: href } : undefined).range(node.from, node.to));
                if (active) {
                    for (const m of marks) out.push(markerShown.range(m.from, m.to));
                    if (url) out.push(Decoration.mark({ class: 'md-mark md-url' }).range(url.from, url.to));
                } else {
                    hide(marks[0].from, marks[0].to);
                    hide(close.from, node.to);
                }
                return false;
            }
        },
    });

    // Blank lines: Prose's gaps between blocks.
    for (let n = 1; n <= doc.lines; n++) {
        const l = doc.line(n);
        if (l.text.trim() !== '' || inMetaSpan(l.from) || blockLines.get(n)?.some((c) => c.startsWith('md-fence')))
            continue;
        const prev = n > 1 ? (blockLines.get(n - 1) ?? []) : [];
        const next = n < doc.lines ? (blockLines.get(n + 1) ?? []) : [];
        let cls = 'md-blank';
        if (prev.some((c) => c.startsWith('md-h '))) cls += ' md-blank-after-h';
        if (next.some((c) => c.startsWith('md-h '))) cls += ' md-blank-before-h';
        addLineClass(n, cls);
    }

    for (const [n, classes] of blockLines) {
        const style = lineStyles.get(n);
        out.push(line(classes.join(' '), style ? { style } : undefined).range(doc.line(n).from));
    }

    return {
        decorations: Decoration.set(out, true),
        prefixes: RangeSet.of(prefixes, true),
    };
}

function metaSpans(meta: Meta) {
    return meta.frontmatter ? [meta.frontmatter, ...meta.esm] : meta.esm;
}

function childrenNamed(node: SyntaxNode, name: string, deep = false): SyntaxNode[] {
    const out: SyntaxNode[] = [];
    const cursor = node.cursor();
    if (!cursor.firstChild()) return out;
    do {
        if (cursor.name === name) out.push(cursor.node);
        else if (deep && cursor.name !== 'Blockquote') out.push(...childrenNamed(cursor.node, name, true));
    } while (cursor.nextSibling());
    return out;
}

function listDepth(item: SyntaxNode): number {
    let depth = 0;
    for (let n: SyntaxNode | null = item.parent; n; n = n.parent) {
        if (n.name === 'BulletList' || n.name === 'OrderedList') depth++;
    }
    return depth;
}

function owningItem(node: SyntaxNode | null): SyntaxNode | null {
    for (let n = node; n; n = n.parent) if (n.name === 'ListItem') return n;
    return null;
}

const jsxTag = Decoration.mark({ class: 'md-jsx-tag' });
const jsxAttr = Decoration.mark({ class: 'md-jsx-attr' });
const jsxValue = Decoration.mark({ class: 'md-jsx-value' });

/** Colour JSX tags in raw form (until phase 2 renders component blocks). */
function jsxTokens(doc: Text, from: number, to: number, out: Range<Decoration>[]) {
    const text = doc.sliceString(from, to);
    for (const m of text.matchAll(/<\/?[A-Za-z][\w.:-]*|\/?>/g))
        out.push(jsxTag.range(from + m.index!, from + m.index! + m[0].length));
    for (const m of text.matchAll(/([\w:-]+)(=)("[^"]*"|'[^']*'|\{[^}]*\})/g)) {
        const s = from + m.index!;
        out.push(jsxAttr.range(s, s + m[1].length));
        out.push(jsxValue.range(s + m[1].length + 1, s + m[0].length));
    }
}

export const livePreview = StateField.define<Preview>({
    create: build,
    update: (value, tr) =>
        tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState) ? build(tr.state) : value,
    provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

/**
 * A pointer click that resolves to the start of a hidden prefix (`## `, `> `, list indentation) means
 * the user clicked the text after it, so put the caret there, never in front of the marker.
 */
export const leanToContent = EditorState.transactionFilter.of((tr) => {
    if (!tr.selection || tr.docChanged || !tr.isUserEvent('select.pointer')) return tr;
    const sources = tr.startState.facet(prefixSource).map((f) => f(tr.startState));
    let moved = false;
    const ranges = tr.selection.ranges.map((r) => {
        if (!r.empty) return r;
        let pos = r.head;
        for (const prefixes of sources) {
            prefixes.between(pos, pos, (from, to) => {
                if (pos >= from && pos < to) pos = to;
            });
        }
        if (pos === r.head) return r;
        moved = true;
        return EditorSelection.cursor(pos);
    });
    return moved ? [tr, { selection: EditorSelection.create(ranges, tr.selection.mainIndex), sequential: true }] : tr;
});

export const livePreviewExtensions = [
    livePreview,
    prefixSource.of((state) => state.field(livePreview).prefixes),
    leanToContent,
];
