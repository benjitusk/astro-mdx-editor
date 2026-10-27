import {
    copyLineDown,
    defaultKeymap,
    historyKeymap,
    moveLineDown,
    moveLineUp,
    redo,
    selectLine,
    undo,
} from '@codemirror/commands';
import { openSearchPanel, searchKeymap, selectNextOccurrence } from '@codemirror/search';
import { Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap, type KeyBinding } from '@codemirror/view';
import {
    indentListItem,
    insertLink,
    setHeading,
    toggleComment,
    toggleInline,
    toggleList,
    toggleQuote,
} from './formatting.ts';
import { pickCallout } from './callouts.ts';
import { togglePanel } from './fmpanel.ts';
import { componentCommands } from './components.ts';
import { openPropsAtCursor } from './props.ts';
import { pickComponent } from './slash.ts';

export interface Command {
    id: string;
    label: string;
    group: string;
    /** Default key, in CodeMirror notation (`Mod` is Cmd on Mac, Ctrl elsewhere). */
    key?: string;
    run: (view: EditorView) => boolean;
}

export interface AppActions {
    save: () => void;
    palette: () => void;
    cheatsheet: () => void;
}

/** Every command the editor has. The keymap, the palette and the cheat sheet all come from this table. */
export function commandTable(app: AppActions): Command[] {
    const action = (fn: () => void) => () => (fn(), true);
    return [
        { id: 'format.bold', label: 'Bold', group: 'Format', key: 'Mod-b', run: toggleInline('bold') },
        { id: 'format.italic', label: 'Italic', group: 'Format', key: 'Mod-i', run: toggleInline('italic') },
        { id: 'format.code', label: 'Inline code', group: 'Format', key: 'Mod-e', run: toggleInline('code') },
        {
            id: 'format.strike',
            label: 'Strikethrough',
            group: 'Format',
            key: 'Mod-Shift-x',
            run: toggleInline('strike'),
        },
        { id: 'format.link', label: 'Link', group: 'Format', key: 'Mod-k', run: insertLink },

        { id: 'block.h1', label: 'Heading 1', group: 'Blocks', key: 'Mod-Alt-1', run: setHeading(1) },
        { id: 'block.h2', label: 'Heading 2', group: 'Blocks', key: 'Mod-Alt-2', run: setHeading(2) },
        { id: 'block.h3', label: 'Heading 3', group: 'Blocks', key: 'Mod-Alt-3', run: setHeading(3) },
        { id: 'block.paragraph', label: 'Paragraph', group: 'Blocks', key: 'Mod-Alt-0', run: setHeading(0) },
        { id: 'block.ol', label: 'Numbered list', group: 'Blocks', key: 'Mod-Shift-7', run: toggleList(true) },
        { id: 'block.ul', label: 'Bulleted list', group: 'Blocks', key: 'Mod-Shift-8', run: toggleList(false) },
        { id: 'block.quote', label: 'Blockquote', group: 'Blocks', key: 'Mod-Shift-.', run: toggleQuote },
        { id: 'block.callout', label: 'Callout…', group: 'Blocks', key: 'Mod-Shift-c', run: pickCallout },

        { id: 'list.indent', label: 'Indent list item', group: 'Lists and lines', key: 'Tab', run: indentListItem(1) },
        {
            id: 'list.outdent',
            label: 'Outdent list item',
            group: 'Lists and lines',
            key: 'Shift-Tab',
            run: indentListItem(-1),
        },
        { id: 'line.up', label: 'Move line up', group: 'Lists and lines', key: 'Alt-ArrowUp', run: moveLineUp },
        { id: 'line.down', label: 'Move line down', group: 'Lists and lines', key: 'Alt-ArrowDown', run: moveLineDown },
        {
            id: 'line.duplicate',
            label: 'Duplicate line',
            group: 'Lists and lines',
            key: 'Mod-Shift-d',
            run: copyLineDown,
        },
        { id: 'line.select', label: 'Select line', group: 'Lists and lines', key: 'Mod-l', run: selectLine },
        { id: 'edit.comment', label: 'Toggle MDX comment', group: 'Lists and lines', key: 'Mod-/', run: toggleComment },

        {
            id: 'component.raw',
            label: 'Show or hide component source',
            group: 'Components',
            key: 'Mod-Enter',
            run: componentCommands.toggleRaw,
        },
        {
            id: 'component.props',
            label: 'Edit component props',
            group: 'Components',
            key: 'Mod-Alt-,',
            run: openPropsAtCursor,
        },
        { id: 'component.insert', label: 'Insert component…', group: 'Components', run: pickComponent },
        {
            id: 'component.leave',
            label: 'Leave component',
            group: 'Components',
            key: 'Escape',
            run: componentCommands.leave,
        },

        {
            id: 'edit.nextOccurrence',
            label: 'Add next occurrence',
            group: 'Editing',
            key: 'Mod-d',
            run: selectNextOccurrence,
        },
        { id: 'edit.undo', label: 'Undo', group: 'Editing', key: 'Mod-z', run: undo },
        { id: 'edit.redo', label: 'Redo', group: 'Editing', key: 'Mod-Shift-z', run: redo },
        { id: 'search.find', label: 'Find', group: 'Editing', key: 'Mod-f', run: openSearchPanel },
        {
            id: 'search.replace',
            label: 'Find and replace',
            group: 'Editing',
            key: 'Mod-Alt-f',
            run: (view) => {
                openSearchPanel(view);
                requestAnimationFrame(() =>
                    view.dom.querySelector<HTMLInputElement>('.cm-search input[name=replace]')?.focus()
                );
                return true;
            },
        },

        { id: 'file.frontmatter', label: 'Frontmatter panel', group: 'App', key: 'Mod-Alt-m', run: togglePanel },
        { id: 'file.save', label: 'Save now', group: 'App', key: 'Mod-s', run: action(app.save) },
        { id: 'app.palette', label: 'Command palette', group: 'App', key: 'Mod-p', run: action(app.palette) },
        {
            id: 'app.cheatsheet',
            label: 'Keyboard shortcuts',
            group: 'App',
            key: 'Mod-Shift-/',
            run: action(app.cheatsheet),
        },
    ];
}

/** The keymap from the command table, with the site's overrides applied. */
export function commandKeymap(commands: Command[], overrides: Record<string, string>): Extension {
    const bindings: KeyBinding[] = [];
    for (const c of commands) {
        const key = overrides[c.id] ?? c.key;
        if (key) bindings.push({ key, run: c.run, preventDefault: true });
    }
    return [
        Prec.high(keymap.of(bindings)),
        // Navigation, deletion and the rest of CodeMirror's standard bindings.
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        // Alt-click adds a cursor (Mod-click is the browser's "open in new tab" habit).
        EditorView.clickAddsSelectionRange.of((e) => e.altKey),
    ];
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** `Mod-Shift-x` → `⌘⇧X` on Mac, `Ctrl+Shift+X` elsewhere. */
export function formatKey(key: string): string {
    const parts = key.split('-');
    const last = parts.pop()!;
    const names: Record<string, string> = isMac
        ? { Mod: '⌘', Alt: '⌥', Shift: '⇧', Ctrl: '⌃' }
        : { Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Ctrl: 'Ctrl' };
    const keys: Record<string, string> = { 'ArrowUp': '↑', 'ArrowDown': '↓', 'Tab': 'Tab', '/': '/', '.': '.' };
    const label = keys[last] ?? (last.length === 1 ? last.toUpperCase() : last);
    const mods = parts.map((p) => names[p] ?? p);
    return isMac ? mods.join('') + label : [...mods, label].join('+');
}
