import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { Document, isMap, isScalar, isSeq, parseDocument, type Node, type Pair, type YAMLMap } from 'yaml';
import { metaField } from './meta.ts';

/**
 * Frontmatter edits that change only the field being edited. The YAML is parsed for its node
 * ranges, and each edit replaces one value's text (or adds or removes one key's lines); nothing is
 * re-serialised, so comments, key order, quoting and line lengths elsewhere stay as written.
 */

/** A text edit, as offsets in the YAML text. */
export interface YamlEdit {
    from: number;
    to: number;
    insert: string;
}

const lineStart = (text: string, pos: number) => text.lastIndexOf('\n', pos - 1) + 1;
const lineEnd = (text: string, pos: number) => {
    const n = text.indexOf('\n', pos);
    return n < 0 ? text.length : n;
};
/** The end of the line holding the last character before `pos`, newline included. */
const afterLine = (text: string, pos: number) => Math.min(text.length, lineEnd(text, Math.max(0, pos - 1)) + 1);

export function parseYaml(text: string) {
    const doc = parseDocument(text, { prettyErrors: false });
    return doc.errors.length ? null : doc;
}

function pairOf(map: YAMLMap, key: string): Pair<Node, Node | null> | undefined {
    return (map.items as Pair<Node, Node | null>[]).find((p) => isScalar(p.key) && String(p.key.value) === key);
}

/** Where a pair's value text ends (its last character, comments after it excluded). */
function valueEnd(text: string, p: Pair<Node, Node | null>): number {
    let end = p.value?.range ? p.value.range[1] : p.key.range![1];
    // A block collection's range runs past its last line's newline.
    while (end > p.key.range![1] && /\s/.test(text[end - 1])) end--;
    return end;
}

/**
 * `key: value` as YAML, for a key at `indent` spaces. A replaced scalar keeps its old style (quotes
 * or plain) where the new value allows it, and a list keeps flow style (`[a, b]`).
 */
function pairText(key: string, value: unknown, indent: number, old: Node | null | undefined): string {
    const doc = new Document({ [key]: value });
    const node = (doc.contents as YAMLMap).items[0].value as Node;
    if (old && isScalar(old) && isScalar(node) && typeof node.value === 'string' && old.type) node.type = old.type;
    if (old && (isSeq(old) || isMap(old)) && old.flow && (isSeq(node) || isMap(node))) node.flow = true;
    const out = doc.toString({ lineWidth: 0 }).replace(/\n$/, '');
    return out
        .split('\n')
        .map((l, i) => (i && l ? ' '.repeat(indent) + l : l))
        .join('\n');
}

/**
 * The edit that sets the field at `path` to `value`, or removes it when `value` is undefined. New keys
 * go after the nearest earlier key in `order` (the schema's order), else first. Null when the YAML
 * doesn't parse or nothing changes.
 */
export function fieldEdit(text: string, path: string[], value: unknown, order: string[] = []): YamlEdit | null {
    const doc = parseYaml(text);
    if (!doc) return null;
    if (doc.contents === null || (isScalar(doc.contents) && doc.contents.value === null)) {
        if (value === undefined) return null;
        return {
            from: text.length,
            to: text.length,
            insert: `${pairText(path[0], nest(path.slice(1), value), 0, null)}\n`,
        };
    }
    if (!isMap(doc.contents)) return null;
    let map = doc.contents as YAMLMap;
    for (let i = 0; i < path.length - 1; i++) {
        const p = pairOf(map, path[i]);
        if (!p || !isMap(p.value)) {
            // A missing (or empty) parent object: set it, with this one field in it.
            if (value === undefined) return null;
            if (p?.value && !(isScalar(p.value) && p.value.value === null)) return null;
            return setPair(text, map, path[i], nest(path.slice(i + 1), value), order);
        }
        map = p.value as YAMLMap;
    }
    return setPair(text, map, path.at(-1)!, value, order);
}

function nest(path: string[], value: unknown): unknown {
    return path.reduceRight<unknown>((v, k) => ({ [k]: v }), value);
}

function setPair(text: string, map: YAMLMap, key: string, value: unknown, order: string[]): YamlEdit | null {
    const pair = pairOf(map, key);
    const first = map.items[0]?.key as Node | undefined;
    const indent = first?.range ? first.range[0] - lineStart(text, first.range[0]) : 0;
    if (pair) {
        const start = lineStart(text, pair.key.range![0]);
        if (value === undefined) return { from: start, to: afterLine(text, valueEnd(text, pair)), insert: '' };
        const next = pairText(key, value, indent, pair.value);
        // Same key text as written; only the value after the colon changes.
        const colon = text.indexOf(':', pair.key.range![1]) + 1;
        const after = next.slice(next.indexOf(':', key.length) + 1);
        const old = pair.value;
        const inline = old && isScalar(old) && old.range && !after.startsWith('\n') && after.startsWith(' ');
        const edit = inline
            ? { from: old.range![0], to: old.range![1], insert: after.slice(1) }
            : { from: colon, to: valueEnd(text, pair), insert: after };
        return text.slice(edit.from, edit.to) === edit.insert ? null : edit;
    }
    if (value === undefined) return null;
    const line = `${' '.repeat(indent)}${pairText(key, value, indent, null)}\n`;
    // After the nearest key that comes before this one in the schema.
    const before = order.slice(0, Math.max(0, order.indexOf(key)));
    const prev = (map.items as Pair<Node, Node | null>[])
        .filter((p) => isScalar(p.key) && before.includes(String(p.key.value)))
        .at(-1);
    let at: number;
    if (prev) at = afterLine(text, valueEnd(text, prev));
    else if (order.includes(key) && map.items.length) at = lineStart(text, (map.items[0].key as Node).range![0]);
    else
        at = map.items.length
            ? afterLine(text, valueEnd(text, map.items.at(-1) as Pair<Node, Node | null>))
            : text.length;
    // A file without a final newline.
    const pre = at === text.length && text && !text.endsWith('\n') ? '\n' : '';
    return { from: at, to: at, insert: pre + (pre ? line.replace(/\n$/, '') : line) };
}

/** The YAML value's own source, for editing it as YAML (lists and objects the panel has no form for). */
export function valueSource(text: string, path: string[]): string {
    const doc = parseYaml(text);
    const node = doc?.getIn(path, true) as Node | undefined;
    if (!node) return '';
    const value = node.toJSON();
    return isScalar(node) ? String(value ?? '') : new Document(value).toString({ lineWidth: 0 }).trimEnd();
}

// ---------- in the editor ----------

/** The frontmatter's YAML (between the fences) and where it starts in the document. */
export function frontmatterText(state: EditorState): { text: string; from: number } | null {
    const fm = state.field(metaField).frontmatter;
    if (!fm) return null;
    const first = state.doc.lineAt(fm.from);
    const last = state.doc.lineAt(fm.to);
    const from = first.to + 1;
    return { text: last.from > from ? state.sliceDoc(from, last.from) : '', from };
}

/** The frontmatter as data, or null when there's none or it doesn't parse. */
export function frontmatterData(state: EditorState): Record<string, unknown> | null {
    const fm = frontmatterText(state);
    if (!fm) return null;
    const doc = parseYaml(fm.text);
    const data = doc?.toJS();
    return data && typeof data === 'object' && !Array.isArray(data) ? data : doc ? {} : null;
}

/** Set (or with undefined, remove) one frontmatter field in the editor. Adds a frontmatter block if there's none. */
export function setField(view: EditorView, path: string[], value: unknown, order: string[] = []): boolean {
    const { state } = view;
    const fm = frontmatterText(state);
    if (!fm) {
        if (value === undefined) return false;
        const edit = fieldEdit('', path, value, order)!;
        view.dispatch({ changes: { from: 0, insert: `---\n${edit.insert}---\n\n` }, userEvent: 'input.frontmatter' });
        return true;
    }
    const edit = fieldEdit(fm.text, path, value, order);
    if (!edit) return false;
    view.dispatch({
        changes: { from: fm.from + edit.from, to: fm.from + edit.to, insert: edit.insert },
        userEvent: 'input.frontmatter',
    });
    return true;
}
