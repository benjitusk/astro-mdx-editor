import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { ChangeSpec, EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { ComponentInfo } from '../types.ts';
import { pickCallout } from './callouts.ts';
import { h } from './dom.ts';
import { metaField } from './meta.ts';
import { openPicker } from './picker.ts';
import { docNode, openProps } from './props.ts';
import { markImported, quoteStyle, registryField } from './registry.ts';
import { isProseAt } from './typography.ts';

/**
 * `/` at the start of a line opens a menu of the components this entry can use (from the registry)
 * and a few Markdown blocks. A component goes in with its required props and the blank lines MDX
 * needs, written the way the collection usually writes it (block, one line, or self-closing), and the
 * cursor goes where its content is typed. A component other entries import but this one doesn't gets
 * its import line added too.
 */

const COMPONENTS = { name: 'Components', rank: 0 };
const BLOCKS = { name: 'Blocks', rank: 1 };

/** A component's MDX with its required props, and where the cursor goes in it. */
export function componentSnippet(comp: ComponentInfo, quote: '"' | "'", indent: string) {
    const attrs = (comp.props ?? [])
        .filter((p) => p.required)
        .map((p) =>
            p.kind === 'boolean'
                ? p.name
                : p.kind === 'number'
                  ? `${p.name}={0}`
                  : p.kind === 'expression'
                    ? `${p.name}={}`
                    : `${p.name}=${quote}${quote}`
        );
    const open = `<${comp.name}${attrs.map((a) => ` ${a}`).join('')}`;
    if (comp.form === 'void') {
        const text = `${open} />\n\n${indent}`;
        return { text, cursor: text.length };
    }
    if (comp.form === 'line') return { text: `${open}></${comp.name}>`, cursor: open.length + 1 };
    // Blank lines around the children, so MDX reads them as Markdown; the cursor on the middle line.
    return { text: `${open}>\n\n${indent}\n\n${indent}</${comp.name}>`, cursor: open.length + 3 + indent.length };
}

/** Where a new import line goes: after the file's last import/export, or after the frontmatter. */
function importChange(state: EditorState, line: string): ChangeSpec {
    const meta = state.field(metaField);
    const last = meta.esm.at(-1);
    if (last) return { from: last.to, insert: `\n${line}` };
    if (meta.frontmatter) return { from: meta.frontmatter.to, insert: `\n\n${line}` };
    return { from: 0, insert: `${line}\n\n` };
}

const blank = (state: EditorState, n: number) => n < 1 || n > state.doc.lines || !state.doc.line(n).text.trim();

/**
 * Replace [from, to) (the rest of a line after its indentation) with a block of text, keeping a blank
 * line between it and any text above or below. `cursor` is an offset in `text`.
 */
function insertBlock(
    view: EditorView,
    from: number,
    to: number,
    text: string,
    cursor: number,
    extra: ChangeSpec[] = [],
    effects: ReturnType<typeof markImported.of>[] = []
) {
    const { state } = view;
    const line = state.doc.lineAt(from);
    const changes: ChangeSpec[] = [...extra];
    if (!blank(state, line.number - 1)) changes.push({ from: line.from, insert: '\n' });
    const after = blank(state, line.number + 1) ? '' : '\n';
    changes.push({ from, to, insert: text + after });
    const set = state.changes(changes);
    const start = set.mapPos(from, 1);
    view.dispatch({
        changes: set,
        selection: { anchor: start + cursor },
        effects,
        scrollIntoView: true,
        userEvent: 'input.complete',
    });
    return start;
}

export function insertComponent(view: EditorView, comp: ComponentInfo, from: number, to: number) {
    const { state } = view;
    const line = state.doc.lineAt(from);
    const indent = /^[ \t]*/.exec(line.text)![0].slice(0, from - line.from);
    const { text, cursor } = componentSnippet(comp, quoteStyle(state), indent);
    const start = insertBlock(
        view,
        from,
        to,
        text,
        cursor,
        comp.import ? [importChange(state, comp.import)] : [],
        comp.import ? [markImported.of(comp.name)] : []
    );
    // Required props are asked for straight away.
    if (comp.props?.some((p) => p.required)) view.dispatch({ effects: openProps.of({ from: start }) });
}

interface BlockItem {
    label: string;
    detail: string;
    run: (view: EditorView, from: number, to: number) => void;
}

const prefix = (p: string) => (view: EditorView, from: number, to: number) =>
    view.dispatch({
        changes: { from, to, insert: p },
        selection: { anchor: from + p.length },
        userEvent: 'input.complete',
    });

const BLOCK_ITEMS: BlockItem[] = [
    { label: 'Heading 1', detail: '#', run: prefix('# ') },
    { label: 'Heading 2', detail: '##', run: prefix('## ') },
    { label: 'Heading 3', detail: '###', run: prefix('### ') },
    { label: 'Bulleted list', detail: '-', run: prefix('- ') },
    { label: 'Numbered list', detail: '1.', run: prefix('1. ') },
    { label: 'Blockquote', detail: '>', run: prefix('> ') },
    {
        label: 'Callout',
        detail: '> [!type]',
        run: (view, from, to) => {
            view.dispatch({ changes: { from, to }, selection: { anchor: from } });
            pickCallout(view);
        },
    },
    {
        label: 'Code block',
        detail: '```',
        run: (view, from, to) => {
            const indent = from - view.state.doc.lineAt(from).from;
            const pad = ' '.repeat(indent);
            insertBlock(view, from, to, `\`\`\`\n${pad}\n${pad}\`\`\``, 3);
        },
    },
    { label: 'Divider', detail: '---', run: (view, from, to) => void insertBlock(view, from, to, '---', 3) },
];

/** The doc's first sentence, without the "Name —" it usually starts with. */
function summary(c: ComponentInfo): string {
    const first = c.doc.split(/(?<=\.)\s|\n\s*\n/)[0].replace(/\s+/g, ' ');
    const s = first.replace(new RegExp(`^${c.name}\\s*[—–-]\\s*`), '');
    return s.length > 60 ? `${s.slice(0, 57).trimEnd()}…` : s;
}

export function slashCompletions(context: CompletionContext): CompletionResult | null {
    const { state, pos } = context;
    const line = state.doc.lineAt(pos);
    const m = /^([ \t]*)\/([\w-]*)$/.exec(line.text.slice(0, pos - line.from));
    if (!m || line.text.slice(pos - line.from).trim()) return null;
    if (!isProseAt(state, line.from + m[1].length)) return null;
    const options: Completion[] = [];
    for (const c of state.field(registryField, false)?.components ?? []) {
        options.push({
            label: c.name,
            detail: summary(c) + (c.import ? ' (adds import)' : ''),
            section: COMPONENTS,
            info: c.doc ? () => docNode(c.doc) : undefined,
            apply: (view, _c, from, to) => insertComponent(view, c, from - 1, to),
        });
    }
    for (const b of BLOCK_ITEMS)
        options.push({
            label: b.label,
            detail: b.detail,
            section: BLOCKS,
            apply: (view, _c, from, to) => b.run(view, from - 1, to),
        });
    return { from: pos - m[2].length, options, validFor: /^[\w-]*$/ };
}

/** "Insert component…" from the palette: on a blank line it goes there, else on a new line below. */
export function pickComponent(view: EditorView): boolean {
    const components = view.state.field(registryField, false)?.components ?? [];
    if (!components.length) return false;
    openPicker(view, {
        placeholder: 'Insert component…',
        items: components,
        text: (c) => `${c.name} ${c.doc}`,
        row: (c) => [h('b', {}, c.name), ' ', h('small', {}, summary(c))],
        onPick: (c) => {
            const { state } = view;
            const line = state.doc.lineAt(state.selection.main.head);
            const indent = /^[ \t]*/.exec(line.text)![0];
            if (!line.text.trim()) return insertComponent(view, c, line.from + indent.length, line.to);
            view.dispatch({ changes: { from: line.to, insert: `\n${indent}` } });
            const at = line.to + 1 + indent.length;
            insertComponent(view, c, at, at);
        },
    });
    return true;
}
