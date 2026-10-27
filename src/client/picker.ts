import type { EditorView } from '@codemirror/view';
import { h } from './dom.ts';

export function openDialog(content: HTMLElement, onClose: () => void) {
    const dialog = h('dialog', { class: 'mdx-editor-dialog' }, content);
    dialog.addEventListener('close', () => {
        dialog.remove();
        onClose();
    });
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.close();
    });
    document.body.append(dialog);
    dialog.showModal();
    return dialog;
}

export interface PickerOptions<T> {
    placeholder: string;
    items: T[];
    /** The text the filter matches. */
    text: (item: T) => string;
    /** The row's contents. */
    row: (item: T) => (Node | string | null)[];
    /** The item to start on. */
    initial?: T;
    onPick: (item: T) => void;
}

/** A filterable list in a dialog (the command palette, the callout type picker). */
export function openPicker<T>(view: EditorView, o: PickerOptions<T>) {
    const input = h('input', {
        'type': 'search',
        'placeholder': o.placeholder,
        'aria-label': o.placeholder,
        'spellcheck': 'false',
    });
    const list = h('ul', { role: 'listbox' });
    let shown: T[] = [];
    let active = o.initial === undefined ? 0 : Math.max(0, o.items.indexOf(o.initial));

    const render = () => {
        const q = input.value.trim().toLowerCase();
        shown = o.items.filter((item) => !q || o.text(item).toLowerCase().includes(q));
        active = Math.min(active, Math.max(0, shown.length - 1));
        list.replaceChildren(
            ...shown.map((item, i) =>
                h(
                    'li',
                    {
                        'role': 'option',
                        'aria-selected': String(i === active),
                        'onmousedown': (e: Event) => (e.preventDefault(), pick(item)),
                    },
                    ...o.row(item)
                )
            )
        );
        list.children[active]?.scrollIntoView({ block: 'nearest' });
    };
    const pick = (item: T) => {
        dialog.close();
        view.focus();
        o.onPick(item);
    };
    input.addEventListener('input', () => {
        active = 0;
        render();
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length);
            render();
        } else if (e.key === 'Enter' && shown[active] !== undefined) {
            e.preventDefault();
            pick(shown[active]);
        }
    });
    const dialog = openDialog(h('div', { class: 'mdx-editor-palette' }, input, list), () => view.focus());
    render();
    input.focus();
}
