import type { EditorState } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

/**
 * GFM tables. With the cursor elsewhere a table is drawn as a real `<table>` (so the site's Prose styles
 * it); with the cursor in it, its source shows, in monospace so the columns line up. A click on a cell
 * puts the caret in that cell's source.
 */

interface Cell {
    /** Offset of the cell's text from the table's start. */
    from: number;
    text: string;
}

interface Table {
    head: Cell[];
    rows: Cell[][];
    align: ('left' | 'center' | 'right' | null)[];
}

function cellsOf(row: SyntaxNode, state: EditorState, start: number): Cell[] {
    const out: Cell[] = [];
    for (let c = row.firstChild; c; c = c.nextSibling)
        if (c.name === 'TableCell') out.push({ from: c.from - start, text: state.sliceDoc(c.from, c.to) });
    return out;
}

export function tableOf(state: EditorState, node: SyntaxNode): Table {
    const start = state.doc.lineAt(node.from).from;
    const table: Table = { head: [], rows: [], align: [] };
    for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.name === 'TableHeader') table.head = cellsOf(c, state, start);
        else if (c.name === 'TableRow') table.rows.push(cellsOf(c, state, start));
        else if (c.name === 'TableDelimiter' && !table.align.length) {
            const text = state.sliceDoc(c.from, state.doc.lineAt(c.from).to);
            table.align = text
                .replace(/^\s*\||\|\s*$/g, '')
                .split('|')
                .map((s) => {
                    const t = s.trim();
                    return t.startsWith(':') && t.endsWith(':')
                        ? 'center'
                        : t.endsWith(':')
                          ? 'right'
                          : t.startsWith(':')
                            ? 'left'
                            : null;
                });
        }
    }
    return table;
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A cell's inline Markdown as HTML: code, strong, emphasis and link text. */
export function cellHtml(src: string): string {
    const parts = src.replace(/\\\|/g, '|').split(/(`[^`]+`)/);
    return parts
        .map((p, i) =>
            i % 2
                ? `<code>${escape(p.slice(1, -1))}</code>`
                : escape(p)
                      .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '<strong>$1$2</strong>')
                      .replace(/(^|[^\w*])[*_]([^*_]+)[*_](?![\w*])/g, '$1<em>$2</em>')
                      .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '<a>$1</a>')
        )
        .join('');
}

class TableWidget extends WidgetType {
    readonly table: Table;
    readonly key: string;
    constructor(table: Table) {
        super();
        this.table = table;
        this.key = JSON.stringify(table);
    }
    eq(other: TableWidget) {
        return other.key === this.key;
    }
    toDOM(view: EditorView) {
        const dom = document.createElement('div');
        dom.className = 'md-table';
        const t = document.createElement('table');
        const row = (cells: Cell[], tag: 'th' | 'td') => {
            const tr = document.createElement('tr');
            cells.forEach((c, i) => {
                const cell = document.createElement(tag);
                cell.innerHTML = cellHtml(c.text);
                cell.dataset.from = String(c.from);
                const align = this.table.align[i];
                if (align) cell.style.textAlign = align;
                tr.append(cell);
            });
            return tr;
        };
        const thead = document.createElement('thead');
        thead.append(row(this.table.head, 'th'));
        const tbody = document.createElement('tbody');
        for (const r of this.table.rows) tbody.append(row(r, 'td'));
        t.append(thead, tbody);
        dom.append(t);
        dom.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const cell = (e.target as Element).closest<HTMLElement>('[data-from]');
            const start = view.posAtDOM(dom);
            let pos = start + Number(cell?.dataset.from ?? 0);
            // Plain text maps character for character; anything else goes to the cell's start.
            const caret = document.caretPositionFromPoint?.(e.clientX, e.clientY);
            const text = cell
                ? this.table.head.concat(...this.table.rows).find((c) => String(c.from) === cell.dataset.from)?.text
                : undefined;
            if (caret && cell && text !== undefined && cell.textContent === text && cell.contains(caret.offsetNode))
                pos += caret.offset;
            view.dispatch({ selection: { anchor: pos }, userEvent: 'select.pointer' });
            view.focus();
        });
        return dom;
    }
    ignoreEvent() {
        return true;
    }
}

/** The decoration for a table: the drawn table, or (with the selection in it) a class per source line. */
export function tableDecorations(
    state: EditorState,
    node: SyntaxNode,
    active: boolean
): { widget?: ReturnType<Decoration['range']>; lines?: number[] } {
    const first = state.doc.lineAt(node.from);
    const last = state.doc.lineAt(node.to);
    if (active) {
        const lines: number[] = [];
        for (let n = first.number; n <= last.number; n++) lines.push(n);
        return { lines };
    }
    const deco = Decoration.replace({ widget: new TableWidget(tableOf(state, node)), block: true });
    return { widget: deco.range(first.from, last.to) };
}
