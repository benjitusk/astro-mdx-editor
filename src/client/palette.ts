import type { EditorView } from '@codemirror/view';
import { formatKey, type Command } from './commands.ts';
import { h } from './dom.ts';
import { openDialog, openPicker } from './picker.ts';

function keyOf(c: Command, overrides: Record<string, string>) {
    const key = overrides[c.id] ?? c.key;
    return key ? h('kbd', {}, formatKey(key)) : null;
}

/** Cmd-P: filter every command by name and run one. */
export function openPalette(view: EditorView, commands: Command[], overrides: Record<string, string>) {
    openPicker(view, {
        placeholder: 'Run a command…',
        items: commands,
        text: (c) => `${c.label} ${c.group}`,
        row: (c) => [h('span', {}, c.label), h('span', { class: 'group' }, c.group), keyOf(c, overrides)],
        onPick: (c) => c.run(view),
    });
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
            'Typing *, _ or ` with text selected wraps it. Enter continues a list or quote. Cmd-Shift-V pastes plain text. ' +
                'Type : and two letters for emoji. Click a callout’s icon to change its type.'
        )
    );
    openDialog(body, () => view.focus());
}
