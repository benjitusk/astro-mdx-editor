import { autocompletion } from '@codemirror/autocomplete';
import { history } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView } from '@codemirror/view';
import type { ClientConfig } from '../types.ts';
import { createApi } from './api.ts';
import { calloutClicks, calloutLooks, calloutTypes, loadCalloutLooks } from './callouts.ts';
import { commandKeymap, commandTable } from './commands.ts';
import { componentExtensions } from './components.ts';
import { emojiCompletions, emojiTable, loadEmoji } from './emoji.ts';
import { bodyStart, frontmatterExtensions, loadSchema } from './fmpanel.ts';
import { imageDrop } from './images.ts';
import { jsxField } from './jsx.ts';
import { fileBase, livePreviewExtensions } from './livepreview.ts';
import { mdxBlocks } from './mdxblocks.ts';
import { metaField } from './meta.ts';
import { openCheatsheet, openPalette } from './palette.ts';
import { loadRegistry } from './registry.ts';
import { smartPaste } from './paste.ts';
import { handleReloads, restoreSnapshot } from './reload.ts';
import { Saver, saveExtension } from './save.ts';
import { slashCompletions } from './slash.ts';
import { typography, wrapOnType } from './typography.ts';

/** Everything that doesn't need a view: shared by the editor and the round-trip test. */
export function stateExtensions(text: string): Extension[] {
    return [
        // Keep the file's own line endings: the document text must stay the file text.
        EditorState.lineSeparator.of(text.includes('\r\n') ? '\r\n' : '\n'),
        EditorState.allowMultipleSelections.of(true),
        // MDX has no indented code blocks (indentation inside components is just indentation).
        // Component tags parse as MDX reads them (src/client/mdxblocks.ts).
        markdown({ base: markdownLanguage, extensions: [{ remove: ['IndentedCode'] }, mdxBlocks] }),
        metaField,
        jsxField,
        calloutLooks,
        emojiTable,
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
                frontmatterExtensions(),
                calloutTypes.of(cfg.callouts),
                fileBase.of(cfg.fileBase),
                calloutClicks,
                // One completion config: `/` menu at a line start, emoji after `:`.
                autocompletion({ override: [slashCompletions, emojiCompletions], icons: false }),
                commandKeymap(commands, cfg.keymap),
                wrapOnType,
                typography(cfg.typography),
                // Before smartPaste: an image on the clipboard can come with HTML too.
                cfg.images ? imageDrop(api) : [],
                smartPaste(),
                drawSelection(),
                EditorView.lineWrapping,
                EditorView.contentAttributes.of({ 'spellcheck': 'true', 'autocorrect': 'off', 'aria-label': 'Editor' }),
                saveExtension(saver),
            ],
        }),
    });
    // Start in the body, not in front of the (collapsed) frontmatter.
    view.dispatch({ selection: { anchor: bodyStart(view.state) } });
    restoreSnapshot(view, cfg);
    handleReloads(view, saver, cfg);
    void loadCalloutLooks(view, api);
    void loadRegistry(view, api);
    void loadSchema(view, api);
    if (cfg.emoji) void loadEmoji(view, cfg.token);
    return { view, saver, commands };
}
