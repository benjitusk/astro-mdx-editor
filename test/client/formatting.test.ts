import { describe, expect, it } from 'vitest';
import {
    indentListItem,
    insertLink,
    setHeading,
    toggleComment,
    toggleInline,
    toggleList,
    toggleQuote,
} from '../../src/client/formatting.ts';
import { marked, view } from './helpers.ts';

const run = (doc: string, cmd: (v: ReturnType<typeof view>) => boolean) => {
    const v = view(doc);
    cmd(v);
    return marked(v);
};

describe('toggleInline', () => {
    it('wraps a selection', () => {
        expect(run('a [word] b', toggleInline('bold'))).toBe('a **[word]** b');
        expect(run('a [word] b', toggleInline('italic'))).toBe('a _[word]_ b');
        expect(run('a [word] b', toggleInline('code'))).toBe('a `[word]` b');
        expect(run('a [word] b', toggleInline('strike'))).toBe('a ~~[word]~~ b');
    });
    it('unwraps when the markers surround or are inside the selection', () => {
        expect(run('a **[word]** b', toggleInline('bold'))).toBe('a [word] b');
        expect(run('a [**word**] b', toggleInline('bold'))).toBe('a [word] b');
    });
    it('removes the format around an empty cursor', () => {
        expect(run('a _wo|rd_ b', toggleInline('italic'))).toBe('a wo|rd b');
    });
    it('inserts an empty pair at a bare cursor', () => {
        expect(run('a | b', toggleInline('bold'))).toBe('a **|** b');
    });
    it('works on every range', () => {
        expect(run('[x] and [y]', toggleInline('italic'))).toBe('_[x]_ and _[y]_');
    });
});

describe('insertLink', () => {
    it('wraps text and puts the cursor in the parentheses', () => {
        expect(run('see [this]', insertLink)).toBe('see [this](|)');
    });
    it('turns a selected URL into a link with the cursor in the label', () => {
        expect(run('[https://example.com]', insertLink)).toBe('[|](https://example.com)');
    });
    it('inserts an empty link at a cursor', () => {
        expect(run('a |', insertLink)).toBe('a [|]()');
    });
});

describe('block commands', () => {
    it('sets and toggles heading levels', () => {
        expect(run('Tit|le', setHeading(2))).toBe('## Tit|le');
        expect(run('## Tit|le', setHeading(3))).toBe('### Tit|le');
        expect(run('## Tit|le', setHeading(2))).toBe('Tit|le');
        expect(run('## Tit|le', setHeading(0))).toBe('Tit|le');
    });
    it('toggles numbered and bulleted lists over lines', () => {
        // The selection stays on the text; the new markers go in front of it.
        expect(run('[one\ntwo]', toggleList(true))).toBe('1. [one\n2. two]');
        expect(run('[1. one\n2. two]', toggleList(true))).toBe('[one\ntwo]');
        expect(run('[1. one\n2. two]', toggleList(false))).toBe('[- one\n- two]');
    });
    it('toggles a blockquote', () => {
        expect(run('[a\nb]', toggleQuote)).toBe('> [a\n> b]');
        expect(run('[> a\n> b]', toggleQuote)).toBe('[a\nb]');
    });
    it('leaves blank lines alone', () => {
        expect(run('[a\n\nb]', toggleQuote)).toBe('> [a\n\n> b]');
    });
});

describe('toggleComment', () => {
    it('wraps the line in an MDX comment and back', () => {
        expect(run('note |here', toggleComment)).toBe('{/* [note here] */}');
        expect(run('{/* note here */}|', toggleComment)).toBe('[note here]');
    });
});

describe('indentListItem', () => {
    it('indents and outdents list items only', () => {
        expect(run('- a\n- b|', indentListItem(1))).toBe('- a\n    - b|');
        expect(run('- a\n    - b|', indentListItem(-1))).toBe('- a\n- b|');
        expect(run('plain|', indentListItem(1))).toBe('plain|');
    });
});
