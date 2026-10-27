import { describe, expect, it } from 'vitest';
import { searchEmoji, setEmojiTable, type EmojiTable } from '../../src/client/emoji.ts';
import { livePreview } from '../../src/client/livepreview.ts';
import { view } from './helpers.ts';

const table: EmojiTable = {
    tada: ['🎉', 'party popper'],
    party_popper: ['🎉', 'party popper'],
    taco: ['🌮', 'taco'],
    smile: ['😄', 'grinning face with smiling eyes'],
};

function emojiIn(doc: string) {
    const v = view(doc);
    v.dispatch({ effects: setEmojiTable.of(table) });
    const out: string[] = [];
    v.state.field(livePreview).atomic.between(0, v.state.doc.length, (from, to) => {
        out.push(v.state.sliceDoc(from, to));
    });
    return out;
}

describe('emoji', () => {
    it('shows known shortcodes in prose as atomic emoji', () => {
        expect(emojiIn('Yay :tada: and :nope: and :taco:|')).toEqual([':tada:', ':taco:']);
    });
    it('leaves code, frontmatter, tags and expressions alone', () => {
        const doc =
            "---\ntitle: :tada:\n---\n\n`:tada:`\n\n<Pull note=':tada:'>x</Pull>\n\n{':tada:'}\n\n```\n:tada:\n```\n|";
        expect(emojiIn(doc)).toEqual([]);
    });
    it('previews shortcodes inside a component', () => {
        expect(emojiIn('<Note>\n\nIn a note :tada:\n\n</Note>\n|')).toEqual([':tada:']);
    });
    it('shows the source when the selection is inside it', () => {
        expect(emojiIn('Yay :ta|da:')).toEqual([]);
    });
    it('ranks prefix matches first, then label words', () => {
        expect(searchEmoji(table, 'ta').map((e) => e[0])).toEqual(['tada', 'taco']);
        expect(searchEmoji(table, 'party').map((e) => e[0])).toEqual(['party_popper', 'tada']);
        expect(searchEmoji(table, 'smil').map((e) => e[0])).toEqual(['smile']);
    });
});
