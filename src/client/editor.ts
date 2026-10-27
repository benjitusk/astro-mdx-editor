import { history } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView } from '@codemirror/view';
import type { ClientConfig } from '../types.ts';
import { createApi } from './api.ts';
import { commandKeymap, commandTable } from './commands.ts';
import { componentExtensions } from './components.ts';
import { jsxField } from './jsx.ts';
import { livePreviewExtensions } from './livepreview.ts';
import { metaField } from './meta.ts';
import { openCheatsheet, openPalette } from './palette.ts';
import { smartPaste } from './paste.ts';
import { handleReloads, restoreSnapshot } from './reload.ts';
import { Saver, saveExtension } from './save.ts';
import { typography, wrapOnType } from './typography.ts';

/** Everything that doesn't need a view: shared by the editor and the round-trip test. */
export function stateExtensions(text: string): Extension[] {
    return [
        // Keep the file's own line endings: the document text must stay the file text.
        EditorState.lineSeparator.of(text.includes('\r\n') ? '\r\n' : '\n'),
        EditorState.allowMultipleSelections.of(true),
        // MDX has no indented code blocks (indentation inside components is just indentation).
        markdown({ base: markdownLanguage, extensions: { remove: ['IndentedCode'] } }),
        metaField,
        jsxField,
        livePreviewExtensions,
        history(),
    ];
}

export function createEditor(parent: HTMLElement, cfg: ClientConfig, text: string) {
    const api = createApi(cfg);
    const saver = new Saver(api, cfg, text);
    const commands = commandTable({
        save: () => void saver.save(),
        palette: () => openPalette(view, commands, cfg.keymap),
        cheatsheet: () => openCheatsheet(view, commands, cfg.keymap),
    });
    const view: EditorView = new EditorView({
        parent,
        state: EditorState.create({
            doc: text,
            extensions: [
                stateExtensions(text),
                componentExtensions(api),
                commandKeymap(commands, cfg.keymap),
                wrapOnType,
                typography(cfg.typography),
                smartPaste(),
                drawSelection(),
                EditorView.lineWrapping,
                EditorView.contentAttributes.of({ 'spellcheck': 'true', 'autocorrect': 'off', 'aria-label': 'Editor' }),
                saveExtension(saver),
            ],
        }),
    });
    restoreSnapshot(view, cfg);
    handleReloads(view, saver, cfg);
    return { view, saver, commands };
}
