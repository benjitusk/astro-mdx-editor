import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, WidgetType, type EditorView } from '@codemirror/view';
import type { Tree } from '@lezer/common';
import { API_BASE, TOKEN_HEADER } from './api.ts';
import { isProseAt } from './typography.ts';

/**
 * `:shortcode:` emoji, resolved with the site's own satteri-emoji catalogs (served by `GET /emoji`).
 *
 * A shortcode shows as its emoji everywhere in prose, cursor or not, and behaves like one character:
 * it's an atomic widget, so arrows step over it and Backspace removes it whole. Nothing ever expands
 * under the cursor, so text never shifts (the source is in the tooltip; Find shows it raw). Typing `:`
 * and two letters opens a completion list.
 */

/** Shortcode → [emoji, label]. */
export type EmojiTable = Record<string, [string, string]>;

export const setEmojiTable = StateEffect.define<EmojiTable>();

export const emojiTable = StateField.define<EmojiTable | null>({
    create: () => null,
    update(value, tr) {
        for (const e of tr.effects) if (e.is(setEmojiTable)) value = e.value;
        return value;
    },
});

/** satteri-emoji's RE_EMOJI. */
const SHORTCODE = /:([^:\s]+):/g;

class EmojiWidget extends WidgetType {
    readonly code: string;
    readonly emoji: string;
    readonly label: string;
    constructor(code: string, emoji: string, label: string) {
        super();
        this.code = code;
        this.emoji = emoji;
        this.label = label;
    }
    eq(other: EmojiWidget) {
        return other.code === this.code && other.emoji === this.emoji;
    }
    toDOM() {
        const el = document.createElement('span');
        el.className = 'md-emoji';
        el.textContent = this.emoji;
        el.title = `:${this.code}: ${this.label}`;
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', this.label);
        return el;
    }
    ignoreEvent() {
        return false;
    }
}

/** Places satteri-emoji doesn't look: code, tags, comments, URLs. */
const NOT_TEXT = new Set([
    'InlineCode',
    'CodeText',
    'FencedCode',
    'CodeInfo',
    'HTMLTag',
    'Comment',
    'CommentBlock',
    'URL',
    'Autolink',
    'LinkLabel',
]);

function inText(state: EditorState, tree: Tree, pos: number): boolean {
    for (let n = tree.resolveInner(pos, 1); ; n = n.parent!) {
        if (NOT_TEXT.has(n.name)) return false;
        // Lezer runs an HTML block on past the tag line; in MDX only the tag lines are JSX.
        if (n.name === 'HTMLBlock' && /^\s*</.test(state.doc.lineAt(pos).text)) return false;
        if (!n.parent) break;
    }
    const line = state.doc.lineAt(pos);
    const before = line.text.slice(0, pos - line.from);
    const lt = before.lastIndexOf('<');
    if (lt > before.lastIndexOf('>') && /^<\/?[A-Za-z]/.test(before.slice(lt))) return false;
    return (before.match(/\{/g)?.length ?? 0) <= (before.match(/\}/g)?.length ?? 0);
}

/** Emoji widgets for the shortcodes in [from, to), skipping any the selection is strictly inside. */
export function emojiDecorations(
    state: EditorState,
    from: number,
    to: number,
    out: Range<Decoration>[],
    atomic: Range<Decoration>[]
) {
    const table = state.field(emojiTable, false);
    if (!table) return;
    const tree = syntaxTree(state);
    const text = state.sliceDoc(from, to);
    const ranges = state.selection.ranges;
    for (const m of text.matchAll(SHORTCODE)) {
        const entry = table[m[1]];
        if (!entry) continue;
        const start = from + m.index!;
        const end = start + m[0].length;
        if (ranges.some((r) => r.from > start && r.from < end) || !inText(state, tree, start)) continue;
        const deco = Decoration.replace({ widget: new EmojiWidget(m[1], entry[0], entry[1]) });
        out.push(deco.range(start, end));
        atomic.push(deco.range(start, end));
    }
}

/** Ranked shortcodes for a query: prefix matches, then label-word matches, then the rest. */
export function searchEmoji(table: EmojiTable, query: string, limit = 40): [string, string, string][] {
    const q = query.toLowerCase();
    const tiers: [string, string, string][][] = [[], [], []];
    for (const [code, [emoji, label]] of Object.entries(table)) {
        const tier = code.startsWith(q)
            ? 0
            : label
                    .toLowerCase()
                    .split(/[\s:-]+/)
                    .some((w) => w.startsWith(q))
              ? 1
              : code.includes(q)
                ? 2
                : -1;
        if (tier >= 0) tiers[tier].push([code, emoji, label]);
    }
    for (const t of tiers) t.sort((a, b) => a[0].length - b[0].length);
    return tiers.flat().slice(0, limit);
}

function emojiCompletions(context: CompletionContext): CompletionResult | null {
    const table = context.state.field(emojiTable, false);
    if (!table) return null;
    const word = context.matchBefore(/:[\w+-]*$/);
    if (!word) return null;
    // `10:30`, `a:b` and `::` aren't shortcodes being typed.
    if (/[\w:]/.test(context.state.sliceDoc(word.from - 1, word.from))) return null;
    if (word.to - word.from < 3 && !context.explicit) return null;
    if (!isProseAt(context.state, word.from)) return null;
    return {
        from: word.from,
        filter: false,
        options: searchEmoji(table, word.text.slice(1)).map(([code, emoji, label]) => ({
            label: `:${code}:`,
            displayLabel: `${emoji} :${code}:`,
            detail: label,
            apply: `:${code}:`,
        })),
    };
}

export const emojiCompletion = autocompletion({ override: [emojiCompletions], icons: false });

export async function loadEmoji(view: EditorView, token: string) {
    try {
        const r = await fetch(`${API_BASE}/emoji`, { headers: { [TOKEN_HEADER]: token } });
        if (r.ok) view.dispatch({ effects: setEmojiTable.of(await r.json()) });
    } catch {
        // no emoji preview; the text is unaffected
    }
}
