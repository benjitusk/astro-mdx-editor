import { StateEffect, StateField, type ChangeSpec, type EditorState } from '@codemirror/state';
import { EditorView, showTooltip, type Tooltip, type TooltipView } from '@codemirror/view';
import type { PropInfo } from '../types.ts';
import { h } from './dom.ts';
import { allElements, elementAt, jsxField, type JsxElement, type JsxProp } from './jsx.ts';
import { toggleRaw } from './raw.ts';
import { componentInfo, quoteStyle } from './registry.ts';

/**
 * The props popover: a form for one element's opening tag, built from the component's `Props`
 * (src/server/registry.ts). Each edit rewrites only the text of the one prop it changes, so the rest
 * of the tag (order, line breaks, quotes, other props) stays exactly as written. Opens from the chip,
 * from a click on a component's own text (a headword, a label), or with Cmd-Alt-,.
 */

// ---------- writing props ----------

/** A prop as MDX: `name='text'`, `name={expr}`, a bare `name`, or null for "leave it out". */
export function attrText(
    name: string,
    kind: PropInfo['kind'] | 'raw',
    value: string | boolean,
    quote: '"' | "'"
): string | null {
    if (kind === 'boolean') return value ? name : null;
    if (typeof value !== 'string') return null;
    if (kind === 'raw') return value === '' ? name : `${name}=${value}`;
    if (kind === 'number' || kind === 'expression') return value.trim() === '' ? null : `${name}={${value}}`;
    if (!value.includes(quote)) return `${name}=${quote}${value}${quote}`;
    const other = quote === '"' ? "'" : '"';
    return value.includes(other) ? `${name}={${JSON.stringify(value)}}` : `${name}=${other}${value}${other}`;
}

/** The change that sets (or with null, removes) one prop in an element's opening tag. */
export function propChange(state: EditorState, el: JsxElement, name: string, attr: string | null): ChangeSpec | null {
    const props = el.props.filter((p) => p.name);
    const prop = props.find((p) => p.name === name);
    if (prop) {
        if (attr === null) {
            // Take the whitespace before it too (a line break and indent when props are one per line).
            const before = state.sliceDoc(el.from, prop.from);
            const gap = /\s*$/.exec(before)![0].length;
            return { from: prop.from - gap, to: prop.to, insert: '' };
        }
        return state.sliceDoc(prop.from, prop.to) === attr ? null : { from: prop.from, to: prop.to, insert: attr };
    }
    if (attr === null) return null;
    const last = el.props.at(-1);
    const at = last ? last.to : el.from + 1 + el.name.length;
    // A tag written one prop per line gets the new prop on a line of its own, indented the same.
    let sep = ' ';
    if (last) {
        const before = state.sliceDoc(el.from, last.from);
        const gap = /\s*$/.exec(before)![0];
        if (gap.includes('\n')) sep = gap;
    }
    return { from: at, insert: sep + attr };
}

// ---------- popover state ----------

interface PropsOpen {
    from: number;
    /** The prop to focus when it opens. */
    focus: string | null;
    tooltip: Tooltip;
}

export const openProps = StateEffect.define<{ from: number; focus?: string | null } | null>();

export const propsField = StateField.define<PropsOpen | null>({
    create: () => null,
    update(value, tr) {
        for (const e of tr.effects) {
            if (!e.is(openProps)) continue;
            value = e.value ? opened(e.value.from, e.value.focus ?? null) : null;
        }
        if (value && tr.docChanged) {
            const from = tr.changes.mapPos(value.from, 1);
            // Keep the same tooltip object's create, so the popover (and the field being typed in) stays.
            value = { ...value, from, tooltip: { ...value.tooltip, pos: from } };
        }
        if (value && !elementFrom(tr.state, value.from)) value = null;
        return value;
    },
    provide: (f) => showTooltip.from(f, (v) => v?.tooltip ?? null),
});

function opened(from: number, focus: string | null): PropsOpen {
    return {
        from,
        focus,
        tooltip: { pos: from, above: false, arrow: false, create: (view) => propsPanel(view) },
    };
}

export function elementFrom(state: EditorState, from: number): JsxElement | null {
    for (const el of allElements(state.field(jsxField))) if (el.from === from) return el;
    return null;
}

/** Cmd-Alt-,: the props of the element the cursor is in. */
export function openPropsAtCursor(view: EditorView): boolean {
    const el = elementAt(view.state.field(jsxField), view.state.selection.main.head);
    if (!el) return false;
    view.dispatch({ effects: openProps.of({ from: el.from }) });
    return true;
}

// ---------- the popover ----------

interface Row {
    name: string;
    info: PropInfo | null;
    input: HTMLInputElement | HTMLSelectElement;
    /** The kind the input currently writes. */
    kind: PropInfo['kind'] | 'raw';
    /** Show the prop's current text in the input. */
    sync: (prop: JsxProp | undefined) => void;
}

/** How a prop's current text reads in the form, for its kind. */
function inputValue(kind: Row['kind'], prop: JsxProp | undefined): string {
    if (!prop) return '';
    if (kind === 'raw') return prop.raw ?? '';
    if (prop.value !== null) return prop.value;
    const raw = prop.raw ?? '';
    if (kind === 'string' && /^\{\s*(["'`])([\s\S]*)\1\s*\}$/.test(raw)) {
        try {
            return JSON.parse(raw.slice(1, -1).trim()) as string;
        } catch {
            // not a plain string literal: shown as an expression below
        }
    }
    return raw.startsWith('{') ? raw.slice(1, -1) : raw;
}

/** A string prop written as an expression (`{name}`) is edited as one, never coerced to text. */
function effectiveKind(info: PropInfo | null, prop: JsxProp | undefined): Row['kind'] {
    if (!info) return prop?.raw === null ? 'boolean' : 'raw';
    if ((info.kind === 'string' || info.kind === 'enum') && prop?.raw?.startsWith('{')) {
        const s = inputValue('string', prop);
        if (s === prop.raw.slice(1, -1)) return 'expression';
        return info.kind === 'enum' && !(info.options ?? []).includes(s) ? 'expression' : info.kind;
    }
    if (info.kind === 'boolean' && prop?.raw?.startsWith('{')) {
        return /^\{\s*(true|false)\s*\}$/.test(prop.raw) ? 'boolean' : 'expression';
    }
    return info.kind;
}

function propsPanel(view: EditorView): TooltipView {
    const state0 = view.state;
    const open = state0.field(propsField)!;
    const el0 = elementFrom(state0, open.from)!;
    const info = componentInfo(state0, el0.name);
    const dom = h('div', { 'class': 'mdx-props', 'role': 'dialog', 'aria-label': `${el0.name} props` });
    const rows: Row[] = [];

    const current = () => {
        const o = view.state.field(propsField);
        return o ? elementFrom(view.state, o.from) : null;
    };
    const close = (refocus = true) => {
        if (view.state.field(propsField)) view.dispatch({ effects: openProps.of(null) });
        if (refocus) view.focus();
    };
    const write = (row: Row) => {
        const el = current();
        if (!el) return;
        const value =
            row.input instanceof HTMLInputElement && row.input.type === 'checkbox'
                ? row.input.checked
                : row.input.value;
        let attr = attrText(row.name, row.kind, value, quoteStyle(view.state));
        // A required string stays in the tag even when emptied, so the gap is visible.
        if (attr === null && row.info?.required && row.kind === 'string')
            attr = attrText(row.name, 'string', '', quoteStyle(view.state));
        const change = propChange(view.state, el, row.name, attr);
        if (change) view.dispatch({ changes: change, userEvent: 'input.props' });
    };

    const names = [...(info?.props ?? []).map((p) => p.name)];
    for (const p of el0.props) if (p.name && !names.includes(p.name)) names.push(p.name);

    const fields = h('div', { class: 'mdx-props-fields' });
    for (const name of names) {
        const pinfo = info?.props?.find((p) => p.name === name) ?? null;
        const prop = el0.props.find((p) => p.name === name);
        const kind = effectiveKind(pinfo, prop);
        const id = `mdx-prop-${name.replace(/\W/g, '-')}`;
        let input: HTMLInputElement | HTMLSelectElement;
        if (kind === 'enum') {
            const dflt = pinfo?.default ? ` (${pinfo.default.replace(/^['"]|['"]$/g, '')})` : '';
            input = h(
                'select',
                { id },
                h('option', { value: '' }, pinfo?.required ? '—' : `default${dflt}`),
                ...(pinfo!.options ?? []).map((o) => h('option', { value: o }, o))
            );
        } else if (kind === 'boolean') {
            input = h('input', { id, type: 'checkbox' });
        } else {
            input = h('input', {
                id,
                type: kind === 'number' ? 'number' : 'text',
                spellcheck: kind === 'string' ? 'true' : 'false',
                placeholder: pinfo?.default ?? '',
            });
        }
        const row: Row = {
            name,
            info: pinfo,
            input,
            kind,
            sync: (p) => {
                if (document.activeElement === input) return;
                if (input instanceof HTMLInputElement && input.type === 'checkbox')
                    input.checked = !!p && (p.raw === null || /^\{\s*true\s*\}$/.test(p.raw));
                else input.value = inputValue(row.kind, p);
            },
        };
        row.sync(prop);
        input.addEventListener(kind === 'boolean' || kind === 'enum' ? 'change' : 'input', () => write(row));
        rows.push(row);
        const code = kind === 'expression' || kind === 'number' || kind === 'raw';
        fields.append(
            h(
                'label',
                { class: `mdx-props-row${code ? ' mdx-props-code' : ''}`, for: id },
                h(
                    'span',
                    { class: 'mdx-props-name' },
                    name,
                    pinfo?.required ? h('i', { title: 'Required' }, '*') : null
                ),
                kind === 'expression' ? h('span', { class: 'mdx-props-braces' }, '{', input, '}') : input,
                pinfo?.doc || (pinfo && pinfo.kind !== kind)
                    ? h(
                          'small',
                          {},
                          pinfo.doc ?? '',
                          pinfo.kind !== kind ? `${pinfo.doc ? ' ' : ''}Written as an expression.` : ''
                      )
                    : null
            )
        );
    }
    if (!names.length)
        fields.append(
            h('p', { class: 'mdx-props-empty' }, info?.props ? 'No props.' : 'Props unknown for this component.')
        );

    const header = h(
        'div',
        { class: 'mdx-props-head' },
        h('b', {}, el0.name),
        info ? h('span', { class: 'mdx-props-file', title: info.file }, info.file.split('/').pop()!) : null
    );
    dom.append(header);
    if (info?.doc) dom.append(h('details', { class: 'mdx-props-doc' }, h('summary', {}, 'About'), docNode(info.doc)));
    dom.append(fields);
    dom.append(
        h(
            'div',
            { class: 'mdx-props-foot' },
            h(
                'button',
                {
                    type: 'button',
                    onclick: () => {
                        const el = current();
                        close(false);
                        if (!el) return;
                        view.dispatch({
                            effects: toggleRaw.of(el.from),
                            selection: { anchor: Math.min(el.from + 1 + el.name.length, el.openTo) },
                            scrollIntoView: true,
                        });
                        view.focus();
                    },
                },
                'Edit as MDX'
            ),
            h('button', { type: 'button', onclick: () => close() }, 'Done')
        )
    );

    dom.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement))) {
            e.preventDefault();
            e.stopPropagation();
            close();
        }
    });
    const outside = (e: MouseEvent) => {
        if (!dom.contains(e.target as Node)) close(false);
    };

    return {
        dom,
        mount() {
            document.addEventListener('mousedown', outside, true);
            const focus = open.focus ? rows.find((r) => r.name === open.focus) : null;
            const target =
                focus ??
                rows.find((r) => r.info?.required && !el0.props.some((p) => p.name === r.name && p.value)) ??
                rows[0];
            (target?.input ?? dom.querySelector('button'))?.focus();
            if (target?.input instanceof HTMLInputElement && target.input.type === 'text') target.input.select();
        },
        update() {
            const el = current();
            if (!el) return;
            for (const r of rows) r.sync(el.props.find((p) => p.name === r.name));
        },
        destroy() {
            document.removeEventListener('mousedown', outside, true);
        },
    };
}

/** A component's header comment as a small block: paragraphs, and indented runs of lines as code. */
export function docNode(doc: string): HTMLElement {
    const out = h('div', { class: 'mdx-doc' });
    let text: string[] = [];
    let code: string[] = [];
    const flush = () => {
        if (text.length) out.append(h('p', {}, text.join(' ')));
        if (code.length) {
            const indent = Math.min(...code.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length));
            out.append(
                h(
                    'pre',
                    {},
                    code
                        .map((l) => l.slice(indent))
                        .join('\n')
                        .trim()
                )
            );
        }
        text = [];
        code = [];
    };
    for (const line of doc.split('\n')) {
        if (/^(?: {2,}|\t)\S/.test(line)) {
            if (text.length) flush();
            code.push(line);
        } else if (!line.trim()) {
            // A blank line ends a paragraph, but not an example (they often have blank lines inside).
            if (code.length) code.push('');
            else flush();
        } else {
            if (code.length) flush();
            text.push(line.trim());
        }
    }
    flush();
    return out;
}

export const propsExtensions = [propsField];
