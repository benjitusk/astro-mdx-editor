import { EditorSelection, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import TurndownService from 'turndown';

const URL_RE = /^(https?:\/\/|mailto:)\S+$/;
// Only convert HTML that carries structure; plain styled text pastes as its text.
const STRUCTURE = /<(a|b|strong|i|em|h[1-6]|ul|ol|li|blockquote|code|pre|table)[\s>]/i;

let turndown: TurndownService | undefined;
function toMarkdown(html: string): string {
    turndown ??= new TurndownService({
        headingStyle: 'atx',
        bulletListMarker: '-',
        codeBlockStyle: 'fenced',
        emDelimiter: '_',
        strongDelimiter: '**',
    });
    return turndown.turndown(html);
}

/**
 * - A URL pasted over selected text links the text.
 * - Rich HTML (from a web page or a doc) becomes Markdown.
 * - Cmd-Shift-V pastes the plain text untouched.
 */
export function smartPaste(): Extension {
    let plainNext = false;
    return EditorView.domEventHandlers({
        keydown(e) {
            plainNext = (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'v';
            return false;
        },
        paste(e, view) {
            const plain = plainNext;
            plainNext = false;
            const data = e.clipboardData;
            if (!data || plain) return false;
            const text = data.getData('text/plain');
            const html = data.getData('text/html');
            const { state } = view;

            if (URL_RE.test(text.trim()) && state.selection.ranges.some((r) => !r.empty)) {
                const url = text.trim();
                view.dispatch(
                    state.changeByRange((r) => {
                        const label = state.sliceDoc(r.from, r.to);
                        const insert = r.empty ? url : `[${label}](${url})`;
                        return {
                            changes: { from: r.from, to: r.to, insert },
                            range: EditorSelection.cursor(r.from + insert.length),
                        };
                    }),
                    { userEvent: 'input.paste' }
                );
                return true;
            }

            if (html && STRUCTURE.test(html)) {
                const md = toMarkdown(html);
                view.dispatch(state.replaceSelection(md), { userEvent: 'input.paste', scrollIntoView: true });
                return true;
            }
            return false;
        },
    });
}
