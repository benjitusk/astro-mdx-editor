import { redo, undo } from '@codemirror/commands';
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { parse as parseYamlValue } from 'yaml';
import type { CollectionSchema, FieldSchema } from '../types.ts';
import type { Api } from './api.ts';
import { h } from './dom.ts';
import { frontmatterData, frontmatterText, setField, valueSource } from './frontmatter.ts';
import { metaField } from './meta.ts';

/**
 * Frontmatter, edited three ways:
 * - in the page: elements the site marks with `data-mdx-field="title"` (the essay's own header) are
 *   editable in place, and stay in sync with the YAML;
 * - in a side panel: a form built from the collection's schema (`GET /schema`), with each field's docs;
 * - as YAML: `</>` on the frontmatter bar, or a search match inside it.
 * In the text, the frontmatter is a one-line bar summarising it; a click on it opens the panel.
 */

// ---------- state ----------

export const setSchema = StateEffect.define<CollectionSchema>();
export const schemaField = StateField.define<CollectionSchema | null>({
    create: () => null,
    update(value, tr) {
        for (const e of tr.effects) if (e.is(setSchema)) value = e.value;
        return value;
    },
});

const toggleFmRaw = StateEffect.define<boolean>();
/** The frontmatter shown as YAML. It closes when the cursor leaves it. */
const fmRaw = StateField.define<boolean>({
    create: () => false,
    update(value, tr) {
        for (const e of tr.effects) if (e.is(toggleFmRaw)) value = e.value;
        const fm = tr.state.field(metaField).frontmatter;
        if (value && (!fm || ((tr.selection || tr.docChanged) && tr.state.selection.main.head > fm.to))) value = false;
        return value;
    },
});

export const openPanel = StateEffect.define<{ focus?: string } | null>();
const panelOpen = StateField.define<{ focus?: string } | null>({
    create: () => null,
    update(value, tr) {
        for (const e of tr.effects) if (e.is(openPanel)) value = e.value;
        return value;
    },
});

/** Where the body starts: the line after the frontmatter. */
export function bodyStart(state: EditorState): number {
    const fm = state.field(metaField).frontmatter;
    return fm ? Math.min(fm.to + 1, state.doc.length) : 0;
}

/** Keys the page edits in place (`data-mdx-field`), left out of the bar and the panel. */
const pageKeys = () => [...document.querySelectorAll<HTMLElement>('[data-mdx-field]')].map((e) => e.dataset.mdxField!);

// ---------- the bar ----------

function short(v: unknown): string {
    const s = Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v ? '{…}' : String(v);
    return s.length > 28 ? `${s.slice(0, 26)}…` : s;
}

class FrontmatterBar extends WidgetType {
    summary: string;
    constructor(summary: string) {
        super();
        this.summary = summary;
    }
    eq(o: FrontmatterBar) {
        return o.summary === this.summary;
    }
    toDOM(view: EditorView) {
        const data = frontmatterData(view.state);
        const skip = pageKeys();
        const chips = data
            ? Object.entries(data)
                  .filter(([k, v]) => !skip.includes(k) && v !== false && v !== null && v !== '')
                  .map(([k, v]) =>
                      h('span', { class: 'mdx-fm-chip' }, h('i', {}, k), v === true ? null : ` ${short(v)}`)
                  )
            : [h('span', { class: 'mdx-fm-error' }, 'The YAML has an error. Click to fix it.')];
        const dom = h(
            'div',
            { class: 'mdx-fm-bar', title: data ? 'Edit frontmatter (Cmd-Alt-M)' : 'Edit the YAML', role: 'button' },
            h('b', {}, 'Frontmatter'),
            ...chips,
            h(
                'button',
                {
                    'class': 'mdx-raw-toggle',
                    'title': 'Show the YAML',
                    'aria-label': 'Show the YAML',
                    'onmousedown': (e: Event) => {
                        e.preventDefault();
                        e.stopPropagation();
                        showYaml(view);
                    },
                },
                '</>'
            )
        );
        dom.addEventListener('mousedown', (e) => {
            if ((e as MouseEvent).button !== 0) return;
            e.preventDefault();
            if (data) view.dispatch({ effects: openPanel.of({}) });
            else showYaml(view);
        });
        return h('div', { class: 'mdx-fm-wrap' }, dom);
    }
    ignoreEvent() {
        return true;
    }
}

function showYaml(view: EditorView) {
    const fm = frontmatterText(view.state);
    if (!fm) return;
    view.dispatch({
        effects: [toggleFmRaw.of(true), openPanel.of(null)],
        selection: { anchor: fm.from },
        scrollIntoView: true,
    });
    view.focus();
}

const bar = StateField.define<DecorationSet>({
    create: (state) => barDecorations(state),
    update: (value, tr) =>
        tr.docChanged ||
        tr.effects.some((e) => e.is(toggleFmRaw)) ||
        tr.startState.field(fmRaw) !== tr.state.field(fmRaw)
            ? barDecorations(tr.state)
            : value,
    provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
});

function barDecorations(state: EditorState): DecorationSet {
    const fm = state.field(metaField).frontmatter;
    if (!fm || state.field(fmRaw)) return Decoration.none;
    const widget = new FrontmatterBar(state.sliceDoc(fm.from, fm.to));
    return Decoration.set([Decoration.replace({ widget, block: true }).range(fm.from, fm.to)]);
}

/**
 * The cursor never sits in the collapsed frontmatter (typing there would land before `---`): it goes
 * to the body instead, and a search match inside it shows the YAML.
 */
const keepOut = EditorState.transactionFilter.of((tr) => {
    if (!tr.selection) return tr;
    const fm = tr.state.field(metaField).frontmatter;
    if (!fm || tr.state.field(fmRaw)) return tr;
    const sel = tr.state.selection.main;
    if (sel.from > fm.to) return tr;
    if (!sel.empty || tr.isUserEvent('select.search')) return [tr, { effects: toggleFmRaw.of(true), sequential: true }];
    return [tr, { selection: { anchor: Math.min(fm.to + 1, tr.state.doc.length) }, sequential: true }];
});

// ---------- the panel ----------

type Kind = 'text' | 'date' | 'enum' | 'number' | 'boolean' | 'list' | 'object' | 'yaml';

function kindOf(s: FieldSchema | undefined, value: unknown): Kind {
    if (!s) {
        if (typeof value === 'boolean') return 'boolean';
        if (typeof value === 'number') return 'number';
        if (typeof value === 'string') return 'text';
        return 'yaml';
    }
    if (s.enum) return 'enum';
    const type = Array.isArray(s.type) ? s.type.filter((t) => t !== 'null') : [s.type];
    if (type.length !== 1) return 'yaml';
    if (type[0] === 'string')
        return s.format === 'date' && (value === undefined || /^\d{4}-\d{2}-\d{2}$/.test(String(value)))
            ? 'date'
            : 'text';
    if (type[0] === 'number' || type[0] === 'integer') return 'number';
    if (type[0] === 'boolean') return 'boolean';
    if (type[0] === 'array' && s.items?.type === 'string' && !s.items.enum) return 'list';
    if (type[0] === 'object' && s.properties && !s.additionalProperties) return 'object';
    return 'yaml';
}

interface Field {
    path: string[];
    /** Show the current value (unless the control has focus). */
    sync: (value: unknown, present: boolean) => void;
}

function get(data: Record<string, unknown> | null, path: string[]): { value: unknown; present: boolean } {
    let v: unknown = data;
    for (const k of path) {
        if (!v || typeof v !== 'object' || !(k in v)) return { value: undefined, present: false };
        v = (v as Record<string, unknown>)[k];
    }
    return { value: v, present: true };
}

function autosize(t: HTMLTextAreaElement) {
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight}px`;
}

class Panel {
    view: EditorView;
    dom: HTMLElement;
    body: HTMLElement;
    fields: Field[] = [];
    built = '';

    constructor(view: EditorView) {
        this.view = view;
        this.body = h('div', { class: 'mdx-fm-fields' });
        this.dom = h(
            'aside',
            { 'class': 'mdx-fm-panel', 'aria-label': 'Frontmatter', 'hidden': true },
            h(
                'div',
                { class: 'mdx-fm-head' },
                h('b', {}, 'Frontmatter'),
                h('button', { type: 'button', class: 'mdx-fm-yaml', onclick: () => showYaml(view) }, 'Edit as YAML'),
                h(
                    'button',
                    { 'type': 'button', 'class': 'mdx-fm-close', 'aria-label': 'Close', 'onclick': () => this.close() },
                    '×'
                )
            ),
            this.body
        );
        this.dom.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.close();
            }
        });
        document.body.append(this.dom);
    }

    close() {
        this.view.dispatch({ effects: openPanel.of(null) });
        this.view.focus();
    }

    update(state: EditorState) {
        const open = state.field(panelOpen);
        this.dom.hidden = !open;
        if (!open) return;
        const data = frontmatterData(state);
        // Rebuild only when the set of rows changes: the schema arrives, a key outside it comes or goes,
        // or the YAML breaks. Schema fields always have a row, so filling one in keeps the focus.
        const props = state.field(schemaField)?.schema.properties ?? {};
        const extra = data && Object.keys(data).filter((k) => !(k in props));
        const shape = JSON.stringify([!!state.field(schemaField), extra, data === null]);
        if (shape !== this.built) {
            const focused = (document.activeElement as HTMLElement | null)?.dataset?.path;
            this.build(state, data);
            this.built = shape;
            if (focused) this.focus(focused);
        }
        for (const f of this.fields) {
            const { value, present } = get(data, f.path);
            f.sync(value, present);
        }
    }

    focus(key?: string) {
        const target =
            (key && this.body.querySelector<HTMLElement>(`[data-path="${CSS.escape(key)}"]`)) ||
            this.body.querySelector<HTMLElement>('input, textarea, select, button');
        target?.focus();
    }

    build(state: EditorState, data: Record<string, unknown> | null) {
        this.fields = [];
        if (!data) {
            this.body.replaceChildren(
                h('p', { class: 'mdx-fm-note' }, 'The frontmatter isn’t valid YAML, so it can only be edited as YAML.')
            );
            return;
        }
        const schema = state.field(schemaField);
        const skip = pageKeys();
        const props = schema?.schema.properties ?? {};
        const keys = [...Object.keys(props), ...Object.keys(data).filter((k) => !(k in props))].filter(
            (k) => !skip.includes(k)
        );
        const rows = keys.map((k) =>
            this.row([k], props[k], (schema?.schema.required ?? []).includes(k), Object.keys(props))
        );
        const notes: HTMLElement[] = [];
        if (skip.length) notes.push(h('p', { class: 'mdx-fm-note' }, `Edit ${skip.join(' and ')} in the page header.`));
        if (!schema)
            notes.push(h('p', { class: 'mdx-fm-note' }, 'No schema found; fields are inferred from their values.'));
        this.body.replaceChildren(...notes, ...rows);
    }

    row(path: string[], s: FieldSchema | undefined, required: boolean, order: string[]): HTMLElement {
        const view = this.view;
        const key = path.join('.');
        const docs = view.state.field(schemaField)?.docs[key] ?? s?.description;
        const initial = get(frontmatterData(view.state), path);
        const kind = kindOf(s, initial.value);
        const write = (v: unknown) => setField(view, path, v, order);
        const msg = h('small', { class: 'mdx-fm-msg' });
        const check = (value: unknown, present: boolean) => {
            let m = '';
            if (required && (!present || value === '' || value === null)) m = 'Required';
            else if (present && kind === 'number' && typeof value === 'number') {
                if (s?.minimum !== undefined && value < s.minimum) m = `At least ${s.minimum}`;
                if (s?.maximum !== undefined && value > s.maximum) m = `At most ${s.maximum}`;
            } else if (present && kind === 'enum' && !s!.enum!.includes(value)) m = `One of ${s!.enum!.join(', ')}`;
            msg.textContent = m;
        };
        const clear = h(
            'button',
            {
                'type': 'button',
                'class': 'mdx-fm-clear',
                'title': 'Remove this field',
                'aria-label': `Remove ${key}`,
                'onclick': () => write(undefined),
            },
            '×'
        );
        let control: HTMLElement;
        let sync: Field['sync'];

        if (kind === 'object') {
            const inner = Object.entries(s!.properties!).map(([k, sub]) =>
                this.row([...path, k], sub, (s!.required ?? []).includes(k), Object.keys(s!.properties!))
            );
            control = h('div', { class: 'mdx-fm-object' }, ...inner);
            sync = () => {};
        } else if (kind === 'boolean') {
            const input = h('input', { 'type': 'checkbox', 'data-path': key, 'onchange': () => write(input.checked) });
            control = input;
            sync = (v) => {
                input.checked = v === true;
            };
        } else if (kind === 'enum') {
            const select = h(
                'select',
                { 'data-path': key, 'onchange': () => write(select.value === '' ? undefined : select.value) },
                h('option', { value: '' }, required ? '—' : '(none)'),
                ...s!.enum!.map((o) => h('option', { value: String(o) }, String(o)))
            );
            control = select;
            sync = (v) => {
                if (document.activeElement !== select) select.value = v === undefined ? '' : String(v);
            };
        } else if (kind === 'number') {
            const input = h('input', { 'type': 'number', 'data-path': key });
            if (s?.minimum !== undefined) input.min = String(s.minimum);
            if (s?.maximum !== undefined) input.max = String(s.maximum);
            const range =
                s?.minimum !== undefined && s?.maximum !== undefined
                    ? h('input', {
                          'type': 'range',
                          'min': String(s.minimum),
                          'max': String(s.maximum),
                          'aria-label': key,
                      })
                    : null;
            const set = (raw: string) => write(raw === '' ? (required ? 0 : undefined) : Number(raw));
            input.addEventListener('input', () => set(input.value));
            range?.addEventListener('input', () => set(range.value));
            control = h('div', { class: 'mdx-fm-number' }, range, input);
            sync = (v, present) => {
                if (document.activeElement !== input) input.value = present && v !== null ? String(v) : '';
                if (range && document.activeElement !== range)
                    range.value = String(typeof v === 'number' ? v : s!.minimum);
                if (range) range.classList.toggle('mdx-fm-unset', !present);
            };
        } else if (kind === 'date') {
            const input = h('input', { 'type': 'date', 'data-path': key });
            input.addEventListener('change', () => write(input.value === '' ? undefined : input.value));
            control = input;
            sync = (v) => {
                if (document.activeElement !== input) input.value = v === undefined ? '' : String(v);
            };
        } else if (kind === 'list') {
            const input = h('input', { 'type': 'text', 'data-path': key, 'placeholder': 'Comma-separated' });
            input.addEventListener('input', () => {
                const items = input.value
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean);
                write(items.length || required ? items : undefined);
            });
            control = input;
            sync = (v) => {
                if (document.activeElement !== input) input.value = Array.isArray(v) ? v.join(', ') : '';
            };
        } else if (kind === 'yaml') {
            const area = h('textarea', {
                'class': 'mdx-fm-code',
                'rows': '1',
                'spellcheck': 'false',
                'data-path': key,
            });
            area.addEventListener('input', () => {
                autosize(area);
                try {
                    const v = area.value.trim() === '' ? undefined : parseYamlValue(area.value);
                    area.classList.remove('mdx-fm-invalid');
                    write(v === undefined && required ? null : v);
                } catch {
                    area.classList.add('mdx-fm-invalid');
                }
            });
            control = area;
            sync = (_v, present) => {
                if (document.activeElement === area) return;
                const fm = frontmatterText(view.state);
                area.value = present && fm ? valueSource(fm.text, path) : '';
                requestAnimationFrame(() => autosize(area));
            };
        } else {
            const area = h('textarea', { 'rows': '1', 'spellcheck': 'true', 'data-path': key });
            area.addEventListener('input', () => {
                autosize(area);
                const v = area.value.replace(/\n/g, ' ');
                write(v === '' && !required ? undefined : v);
            });
            area.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') e.preventDefault();
            });
            control = area;
            sync = (v) => {
                if (document.activeElement === area) return;
                area.value = v === undefined || v === null ? '' : String(v);
                requestAnimationFrame(() => autosize(area));
            };
        }

        const show = sync;
        this.fields.push({
            path,
            sync: (v, present) => {
                show(v, present);
                clear.hidden = required || !present;
                check(v, present);
            },
        });
        const label = h(
            'span',
            { class: 'mdx-fm-key' },
            path.at(-1)!,
            required ? h('i', { title: 'Required' }, '*') : null,
            s ? null : h('small', { class: 'mdx-fm-extra', title: 'Not in the collection’s schema' }, ' not in schema')
        );
        return h(
            kind === 'object' ? 'fieldset' : 'label',
            { class: `mdx-fm-row mdx-fm-${kind}` },
            h('span', { class: 'mdx-fm-label' }, label, clear),
            control,
            docs ? h('small', { class: 'mdx-fm-doc' }, docs) : null,
            msg
        );
    }

    destroy() {
        this.dom.remove();
    }
}

const panel = ViewPlugin.fromClass(
    class {
        panel: Panel;
        constructor(view: EditorView) {
            this.panel = new Panel(view);
            this.panel.update(view.state);
        }
        update(u: ViewUpdate) {
            const was = u.startState.field(panelOpen);
            const now = u.state.field(panelOpen);
            if (u.docChanged || was !== now || u.transactions.some((t) => t.effects.some((e) => e.is(setSchema))))
                this.panel.update(u.state);
            if (now && now !== was) requestAnimationFrame(() => this.panel.focus(now.focus));
        }
        destroy() {
            this.panel.destroy();
        }
    }
);

/** Cmd-Alt-M: open or close the panel. */
export function togglePanel(view: EditorView): boolean {
    view.dispatch({ effects: openPanel.of(view.state.field(panelOpen) ? null : {}) });
    if (!view.state.field(panelOpen)) view.focus();
    return true;
}

// ---------- fields in the page ----------

/**
 * Elements the site marks with `data-mdx-field` (in thoughts, the essay header's title and dek) edit
 * that field in place: typing writes the YAML, and changes to the YAML (the panel, undo, raw edits)
 * show in the element. Enter moves on to the next field, then to the body.
 */
const pageFields = ViewPlugin.fromClass(
    class {
        view: EditorView;
        els: HTMLElement[];
        constructor(view: EditorView) {
            this.view = view;
            this.els = [...document.querySelectorAll<HTMLElement>('[data-mdx-field]')];
            for (const el of this.els) this.bind(el);
            this.sync();
        }
        bind(el: HTMLElement) {
            const view = this.view;
            const path = el.dataset.mdxField!.split('.');
            el.contentEditable = 'plaintext-only';
            el.spellcheck = true;
            el.classList.add('mdx-page-field');
            el.addEventListener('input', () => {
                const order = Object.keys(view.state.field(schemaField)?.schema.properties ?? {});
                setField(view, path, (el.textContent ?? '').replace(/\s*\n\s*/g, ' '), order);
            });
            el.addEventListener('keydown', (e) => {
                const mod = e.metaKey || e.ctrlKey;
                if (e.key === 'Enter' || (e.key === 'Escape' && !mod)) {
                    e.preventDefault();
                    const next = this.els[this.els.indexOf(el) + 1];
                    if (e.key === 'Enter' && next) {
                        next.focus();
                        getSelection()?.selectAllChildren(next);
                        getSelection()?.collapseToEnd();
                        return;
                    }
                    view.dispatch({ selection: { anchor: bodyStart(view.state) }, scrollIntoView: true });
                    view.focus();
                } else if (mod && e.key.toLowerCase() === 'z') {
                    e.preventDefault();
                    (e.shiftKey ? redo : undo)(view);
                    this.sync(true);
                }
            });
        }
        update(u: ViewUpdate) {
            if (u.docChanged) this.sync();
        }
        sync(force = false) {
            const data = frontmatterData(this.view.state);
            if (!data) return;
            for (const el of this.els) {
                if (!force && document.activeElement === el) continue;
                const { value } = get(data, el.dataset.mdxField!.split('.'));
                const text = value === undefined || value === null ? '' : String(value);
                if (el.textContent !== text) el.textContent = text;
            }
        }
    }
);

export async function loadSchema(view: EditorView, api: Api) {
    try {
        view.dispatch({ effects: setSchema.of(await api.schema()) });
    } catch {
        // the panel infers fields from their values
    }
}

export function frontmatterExtensions(): Extension {
    return [schemaField, fmRaw, panelOpen, bar, keepOut, panel, pageFields];
}
