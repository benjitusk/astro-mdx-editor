import type { EditorView } from '@codemirror/view';
import { formatKey, type Command } from './commands.ts';
import { h } from './dom.ts';

function keyOf(c: Command, overrides: Record<string, string>) {
    const key = overrides[c.id] ?? c.key;
    return key ? h('kbd', {}, formatKey(key)) : null;
}

function openDialog(content: HTMLElement, onClose: () => void) {
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

/** Cmd-P: filter every command by name and run one. */
export function openPalette(view: EditorView, commands: Command[], overrides: Record<string, string>) {
    const input = h('input', {
        'type': 'search',
        'placeholder': 'Run a command…',
        'aria-label': 'Command',
        'spellcheck': 'false',
    });
    const list = h('ul', { role: 'listbox' });
    let shown: Command[] = [];
    let active = 0;

    const render = () => {
        const q = input.value.trim().toLowerCase();
        shown = commands.filter((c) => !q || `${c.label} ${c.group}`.toLowerCase().includes(q));
        active = Math.min(active, Math.max(0, shown.length - 1));
        list.replaceChildren(
            ...shown.map((c, i) =>
                h(
                    'li',
                    {
                        'role': 'option',
                        'aria-selected': String(i === active),
                        'onmousedown': (e: Event) => (e.preventDefault(), run(c)),
                    },
                    h('span', {}, c.label),
                    h('span', { class: 'group' }, c.group),
                    keyOf(c, overrides)
                )
            )
        );
        list.children[active]?.scrollIntoView({ block: 'nearest' });
    };
    const run = (c: Command) => {
        dialog.close();
        view.focus();
        c.run(view);
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
        } else if (e.key === 'Enter' && shown[active]) {
            e.preventDefault();
            run(shown[active]);
        }
    });
    const dialog = openDialog(h('div', { class: 'mdx-editor-palette' }, input, list), () => view.focus());
    render();
    input.focus();
}

/** Cmd-Shift-/: every shortcut, by group. */
export function openCheatsheet(view: EditorView, commands: Command[], overrides: Record<string, string>) {
    const groups = Map.groupBy(commands, (c) => c.group);
    const body = h(
        'div',
        { class: 'mdx-editor-cheatsheet' },
        h('h2', {}, 'Keyboard shortcuts'),
        ...[...groups].map(([group, cs]) =>
            h(
                'section',
                {},
                h('h3', {}, group),
                h('dl', {}, ...cs.flatMap((c) => [h('dt', {}, c.label), h('dd', {}, keyOf(c, overrides) ?? '')]))
            )
        ),
        h(
            'p',
            { class: 'note' },
            'Typing *, _ or ` with text selected wraps it. Enter continues a list or quote. Cmd-Shift-V pastes plain text.'
        )
    );
    openDialog(body, () => view.focus());
}
