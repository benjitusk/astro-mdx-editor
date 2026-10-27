import { syntaxTree } from '@codemirror/language';
import {
    EditorSelection,
    Facet,
    StateEffect,
    StateField,
    type EditorState,
    type TransactionSpec,
} from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { DEFAULT_CALLOUT_TYPES } from '../defaults.ts';
import type { Api } from './api.ts';
import { h } from './dom.ts';
import { openPicker } from './picker.ts';

/**
 * Obsidian callouts (`> [!type] Title`), drawn as the site draws them.
 *
 * - A quote whose first line opens with `[!type]` becomes a card. Every line of the quote is a line of
 *   the card, so the text stays ordinary editable lines and clicks land as on any other line.
 * - `[!type]` and the space after it become the type's icon, an atomic widget: the title starts where
 *   the site's does, and nothing moves when the cursor arrives. Clicking the icon changes the type.
 * - The card's look is measured, not copied: every type is rendered once by the site's own pipeline
 *   into a hidden probe inside Prose, and its computed styles become CSS variables on the card's lines.
 *   That works for any site's callout CSS, and types the site doesn't render as callouts stay quotes.
 */

/** The types the editor offers; the site's config, or satteri-callouts' Obsidian set. */
export const calloutTypes = Facet.define<string[], string[]>({
    combine: (values) => (values.length ? values.flat() : DEFAULT_CALLOUT_TYPES).map((t) => t.toLowerCase()),
});

export interface CalloutLook {
    /** The site's icon markup for the type. */
    icon: string;
    /** The title the site shows when a callout has none. */
    title: string;
    /** The icon's colour, for the type picker (which sits outside the card). */
    color: string;
}

export const setCalloutLooks = StateEffect.define<Map<string, CalloutLook>>();

/** Measured looks by type, once the probe has run (null before). */
export const calloutLooks = StateField.define<Map<string, CalloutLook> | null>({
    create: () => null,
    update(value, tr) {
        for (const e of tr.effects) if (e.is(setCalloutLooks)) value = e.value;
        return value;
    },
});

/** `[!type]`, an optional fold sign, and the space before the title (as satteri-callouts reads it). */
const MARK = /^\[!([\w-]+)\]([+-]?)[ \t]*/;

export interface CalloutMark {
    type: string;
    /** `[!type]` with its fold sign and the space after it. */
    from: number;
    to: number;
    /** The type's text inside the brackets. */
    typeFrom: number;
    typeTo: number;
    /** No title after the marker: the site shows the type's default title. */
    untitled: boolean;
}

/** The `[!…]` marker opening a top-level quote, whether or not the type is one the site knows. */
export function markOf(state: EditorState, quote: SyntaxNode): CalloutMark | null {
    if (quote.name !== 'Blockquote' || quote.parent?.name !== 'Document') return null;
    const quoteMark = quote.getChild('QuoteMark');
    if (!quoteMark) return null;
    const line = state.doc.lineAt(quoteMark.from);
    const start = state.sliceDoc(quoteMark.to, quoteMark.to + 1) === ' ' ? quoteMark.to + 1 : quoteMark.to;
    const m = MARK.exec(state.sliceDoc(start, line.to));
    if (!m) return null;
    const to = start + m[0].length;
    return {
        type: m[1].toLowerCase(),
        from: start,
        to,
        typeFrom: start + 2,
        typeTo: start + 2 + m[1].length,
        untitled: to === line.to,
    };
}

export function isCalloutType(state: EditorState, type: string): boolean {
    const looks = state.field(calloutLooks, false);
    return looks ? looks.has(type) : state.facet(calloutTypes).includes(type);
}

/** The callout a quote opens, or null for a plain quote. */
export function calloutOf(state: EditorState, quote: SyntaxNode): CalloutMark | null {
    const mark = markOf(state, quote);
    return mark && isCalloutType(state, mark.type) ? mark : null;
}

const fallbackTitle = (type: string) => type.charAt(0).toUpperCase() + type.slice(1);

class CalloutMarkWidget extends WidgetType {
    readonly type: string;
    readonly look: CalloutLook | undefined;
    readonly untitled: boolean;
    constructor(type: string, look: CalloutLook | undefined, untitled: boolean) {
        super();
        this.type = type;
        this.look = look;
        this.untitled = untitled;
    }
    eq(other: CalloutMarkWidget) {
        return other.type === this.type && other.look === this.look && other.untitled === this.untitled;
    }
    toDOM() {
        const el = h('span', { class: 'md-callout-mark' }, iconElement(this.look, 'Change the callout type'));
        if (this.untitled)
            el.append(h('span', { class: 'md-callout-fallback' }, this.look?.title ?? fallbackTitle(this.type)));
        return el;
    }
    // Let the editor place the caret on clicks beside the icon (the icon's own click is handled below).
    ignoreEvent() {
        return false;
    }
}

function iconElement(look: CalloutLook | undefined, title?: string, colour = false) {
    const icon = h('span', { class: 'md-callout-icon', title });
    if (colour && look) icon.style.color = look.color;
    // Markup from the site's own render of the type (see loadCalloutLooks), never from the document.
    if (look?.icon) icon.innerHTML = look.icon;
    return icon;
}

export function calloutMarkDecoration(state: EditorState, mark: CalloutMark) {
    const look = state.field(calloutLooks, false)?.get(mark.type);
    return Decoration.replace({ widget: new CalloutMarkWidget(mark.type, look, mark.untitled) });
}

function quoteAt(state: EditorState, pos: number): SyntaxNode | null {
    for (const side of [-1, 1] as const) {
        for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); n; n = n.parent) {
            if (n.name === 'Blockquote' && n.parent?.name === 'Document') return n;
        }
    }
    return null;
}

/**
 * Make the block at the cursor a callout of `type`:
 * - in a callout (or a `[!…]` quote the site doesn't know): change its type;
 * - in a plain quote: add a `[!type]` line above it;
 * - on a blank line: start a callout there, with the cursor where the title goes;
 * - otherwise: quote the selected lines, or the paragraph, under a `[!type]` line.
 */
export function setCallout(state: EditorState, type: string): TransactionSpec {
    const { doc, lineBreak } = state;
    const range = state.selection.main;
    const quote = quoteAt(state, range.head);
    if (quote) {
        const mark = markOf(state, quote);
        if (mark) return { changes: { from: mark.typeFrom, to: mark.typeTo, insert: type } };
        const first = doc.lineAt(quote.from);
        const indent = /^\s*/.exec(first.text)![0];
        return { changes: { from: first.from, insert: `${indent}> [!${type}]${lineBreak}` } };
    }
    let a = doc.lineAt(range.from).number;
    let b = doc.lineAt(range.to).number;
    if (range.empty) {
        const l = doc.line(a);
        if (!l.text.trim()) {
            // Text right above or below would run into the quote; keep blank lines between.
            const above = a > 1 && doc.line(a - 1).text.trim() ? lineBreak : '';
            const below = a < doc.lines && doc.line(a + 1).text.trim() ? lineBreak : '';
            const head = `${above}> [!${type}] `;
            return {
                changes: { from: l.from, to: l.to, insert: head + below },
                selection: EditorSelection.cursor(l.from + head.length),
            };
        }
        while (a > 1 && doc.line(a - 1).text.trim()) a--;
        while (b < doc.lines && doc.line(b + 1).text.trim()) b++;
    }
    const changes = [];
    for (let n = a; n <= b; n++)
        changes.push({ from: doc.line(n).from, insert: n === a ? `> [!${type}]${lineBreak}> ` : '> ' });
    return { changes };
}

/** Cmd-Shift-C, or a click on a callout's icon: pick a type for the block at the cursor. */
export function pickCallout(view: EditorView): boolean {
    const { state } = view;
    const looks = state.field(calloutLooks, false);
    const types = state.facet(calloutTypes).filter((t) => !looks || looks.has(t));
    const quote = quoteAt(state, state.selection.main.head);
    const current = quote ? markOf(state, quote)?.type : undefined;
    openPicker(view, {
        placeholder: current ? 'Change the callout type…' : 'Insert a callout…',
        items: types,
        initial: current && types.includes(current) ? current : undefined,
        text: (t) => `${t} ${looks?.get(t)?.title ?? ''}`,
        row: (t) => [
            iconElement(looks?.get(t), undefined, true),
            h('span', {}, looks?.get(t)?.title ?? fallbackTitle(t)),
            h('span', { class: 'group' }, t),
        ],
        onPick: (t) => view.dispatch({ ...setCallout(view.state, t), scrollIntoView: true, userEvent: 'input' }),
    });
    return true;
}

/** A click on a callout's icon opens the type picker, with the caret at the start of the title. */
const iconClicks = EditorView.domEventHandlers({
    mousedown(event, view) {
        const icon = (event.target as Element).closest?.('.md-callout-icon');
        if (!icon || !view.contentDOM.contains(icon) || event.button !== 0) return false;
        event.preventDefault();
        const pos = view.posAtDOM(icon);
        const quote = quoteAt(view.state, pos);
        const mark = quote && markOf(view.state, quote);
        view.dispatch({ selection: { anchor: mark ? mark.to : pos } });
        pickCallout(view);
        return true;
    },
});

export const calloutClicks = iconClicks;

const STYLE_ID = 'mdx-editor-callout-looks';

/**
 * Measure how the site draws each callout type and style the cards to match. The types are rendered
 * once through the site's pipeline (the render API), placed in a hidden probe inside the editor's
 * Prose, and read back with getComputedStyle. Colours are resolved values, so it measures again when
 * the colour scheme changes.
 */
export async function loadCalloutLooks(view: EditorView, api: Pick<Api, 'render'>) {
    const types = view.state.facet(calloutTypes);
    let html: string | undefined;
    try {
        ({ html } = await api.render(types.map((t) => `> [!${t}]\n> x`).join('\n\n'), ''));
    } catch {
        return;
    }
    if (!html) return;
    const apply = () => {
        const probe = h('div', { 'class': 'mdx-callout-probe', 'aria-hidden': 'true' });
        probe.innerHTML = html;
        (view.dom.parentElement ?? document.body).append(probe);
        let measured;
        try {
            measured = measureProbe(probe, types);
        } finally {
            probe.remove();
        }
        if (!measured) return;
        let style = document.getElementById(STYLE_ID);
        if (!style) document.head.append((style = h('style', { id: STYLE_ID })));
        style.textContent = measured.css;
        view.dispatch({ effects: setCalloutLooks.of(measured.looks) });
    };
    apply();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
    new MutationObserver(apply).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-theme'],
    });
}

type Side = 'Top' | 'Right' | 'Bottom' | 'Left';

function measureProbe(probe: HTMLElement, types: string[]) {
    const blocks = [...probe.children] as HTMLElement[];
    // One block per type, in order; anything else means the render isn't what we asked for.
    if (blocks.length !== types.length) return null;
    const looks = new Map<string, CalloutLook>();
    const rules: string[] = [];
    types.forEach((type, i) => {
        const el = blocks[i];
        if (!el.matches('[data-callout]')) return; // the site renders it as a plain quote
        const title = el.querySelector<HTMLElement>('.callout-title') ?? (el.firstElementChild as HTMLElement | null);
        const content =
            el.querySelector<HTMLElement>('.callout-content') ?? (el.lastElementChild as HTMLElement | null);
        if (!title || !content) return;
        const titleText = el.querySelector<HTMLElement>('.callout-title-text') ?? title;
        const icon = el.querySelector<HTMLElement>('.callout-title-icon');
        const body = (content.firstElementChild as HTMLElement | null) ?? content;
        const box = getComputedStyle(el);
        const t = getComputedStyle(title);
        const tt = getComputedStyle(titleText);
        const b = getComputedStyle(body);
        const gap = body.getBoundingClientRect().top - title.getBoundingClientRect().bottom;
        const vars: Record<string, string> = {
            '--co-bg': box.backgroundColor,
            '--co-bg-image': box.backgroundImage,
            '--co-blend': box.mixBlendMode,
            '--co-pt': box.paddingTop,
            '--co-pr': box.paddingRight,
            '--co-pb': box.paddingBottom,
            '--co-pl': box.paddingLeft,
            '--co-r-tl': box.borderTopLeftRadius,
            '--co-r-tr': box.borderTopRightRadius,
            '--co-r-br': box.borderBottomRightRadius,
            '--co-r-bl': box.borderBottomLeftRadius,
            '--co-color': b.color,
            '--co-font': b.fontFamily,
            '--co-size': b.fontSize,
            '--co-leading': b.lineHeight,
            '--co-gap': `${Math.max(0, gap)}px`,
            '--co-t-color': tt.color,
            '--co-t-font': tt.fontFamily,
            '--co-t-size': tt.fontSize,
            '--co-t-weight': tt.fontWeight,
            '--co-t-leading': t.lineHeight,
            '--co-t-gap': t.columnGap === 'normal' ? '0.5em' : t.columnGap,
            '--co-i-color': icon ? getComputedStyle(icon).color : tt.color,
            '--co-i-size': icon ? `${icon.getBoundingClientRect().width}px` : '1em',
        };
        for (const side of ['Top', 'Right', 'Bottom', 'Left'] as Side[]) {
            const s = side[0].toLowerCase();
            const width = box.getPropertyValue(`border-${side.toLowerCase()}-width`);
            vars[`--co-bw-${s}`] = width;
            vars[`--co-b${s}`] =
                `${width} ${box.getPropertyValue(`border-${side.toLowerCase()}-style`)} ${box.getPropertyValue(`border-${side.toLowerCase()}-color`)}`;
        }
        const decls = Object.entries(vars)
            .map(([k, v]) => `${k}: ${v};`)
            .join(' ');
        rules.push(`.mdx-editor .md-callout[data-callout="${CSS.escape(type)}"] { ${decls} }`);
        looks.set(type, {
            icon: icon?.innerHTML ?? '',
            title: titleText.textContent?.trim() || fallbackTitle(type),
            color: vars['--co-i-color'],
        });
    });
    return { looks, css: rules.join('\n') };
}
