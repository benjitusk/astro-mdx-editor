import { history } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView } from '@codemirror/view';
import type { ClientConfig } from '../types.ts';
import { createApi } from './api.ts';
import { metaField } from './meta.ts';
import { handleReloads, restoreSnapshot } from './reload.ts';
import { Saver, saveExtension } from './save.ts';

/** Everything that doesn't need a view: shared by the editor and the round-trip test. */
export function stateExtensions(text: string): Extension[] {
    return [
        // Keep the file's own line endings: the document text must stay the file text.
        EditorState.lineSeparator.of(text.includes('\r\n') ? '\r\n' : '\n'),
        markdown({ base: markdownLanguage }),
        metaField,
        history(),
    ];
}

export function createEditor(parent: HTMLElement, cfg: ClientConfig, text: string) {
    const api = createApi(cfg);
    const saver = new Saver(api, cfg, text);
    const view = new EditorView({
        parent,
        state: EditorState.create({
            doc: text,
            extensions: [
                stateExtensions(text),
                drawSelection(),
                EditorView.lineWrapping,
                EditorView.contentAttributes.of({ 'spellcheck': 'true', 'autocorrect': 'off', 'aria-label': 'Editor' }),
                saveExtension(saver),
            ],
        }),
    });
    restoreSnapshot(view, cfg);
    handleReloads(view, saver, cfg);
    return { view, saver };
}
