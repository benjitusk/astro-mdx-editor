import { describe, expect, it } from 'vitest';
import { fieldEdit, valueSource } from '../../src/client/frontmatter.ts';

const apply = (text: string, path: string[], value: unknown, order?: string[]) => {
    const e = fieldEdit(text, path, value, order);
    return e ? text.slice(0, e.from) + e.insert + text.slice(e.to) : text;
};

const fm = `title: Is judging people so bad, really?
description: The demonization of an intellectual reflex. Or something else dramatic and eye catching. Idk, ur still reading so it's working.
pubDate: 2026-10-21
# the chip
topic: Ethics
draft: true
`;
const order = ['title', 'description', 'pubDate', 'updatedDate', 'topic', 'claim', 'confidence', 'draft'];

describe('fieldEdit', () => {
    it('replaces only the value it sets', () => {
        expect(apply(fm, ['topic'], 'Morality')).toBe(fm.replace('topic: Ethics', 'topic: Morality'));
        expect(apply(fm, ['draft'], false)).toBe(fm.replace('draft: true', 'draft: false'));
        // The long dek isn't folded or quoted.
        expect(apply(fm, ['title'], 'Judging')).toBe(fm.replace('Is judging people so bad, really?', 'Judging'));
    });
    it('keeps quote style, and quotes when the value needs it', () => {
        expect(apply("title: 'A'\n", ['title'], 'B')).toBe("title: 'B'\n");
        expect(apply('title: A\n', ['title'], 'Yes: no')).toBe('title: "Yes: no"\n');
        expect(apply('topic: A\n', ['topic'], 'true')).toBe('topic: "true"\n');
    });
    it('adds a key after the nearest earlier key in schema order', () => {
        expect(apply(fm, ['confidence'], 70, order)).toBe(fm.replace('draft: true', 'confidence: 70\ndraft: true'));
        expect(apply(fm, ['updatedDate'], '2026-10-27', order)).toBe(
            fm.replace('pubDate: 2026-10-21\n', 'pubDate: 2026-10-21\nupdatedDate: 2026-10-27\n')
        );
        expect(apply('a: 1', ['b'], 2)).toBe('a: 1\nb: 2');
    });
    it('removes a key with its line, keeping comments above other keys', () => {
        expect(apply(fm, ['draft'], undefined)).toBe(fm.replace('draft: true\n', ''));
        expect(apply(fm, ['topic'], undefined)).toBe(fm.replace('topic: Ethics\n', ''));
    });
    it('writes lists in their existing style, and nested fields at their indent', () => {
        expect(apply('tags: [a, b]\n', ['tags'], ['a', 'c'])).toBe('tags: [ a, c ]\n');
        expect(apply('tags:\n  - a\nx: 1\n', ['tags'], ['a', 'b'])).toBe('tags:\n  - a\n  - b\nx: 1\n');
        expect(apply('hero:\n  motif: grid\n', ['hero', 'seed'], 3)).toBe('hero:\n  motif: grid\n  seed: 3\n');
        expect(apply('hero:\n  motif: grid\n', ['hero', 'motif'], 'dots')).toBe('hero:\n  motif: dots\n');
        expect(apply('title: x\n', ['hero', 'motif'], 'dots')).toBe('title: x\nhero:\n  motif: dots\n');
    });
    it('refuses to edit YAML that does not parse', () => {
        expect(fieldEdit('title: [oops\n', ['title'], 'x')).toBe(null);
    });
    it('starts an empty frontmatter', () => {
        expect(apply('', ['title'], 'New')).toBe('title: New\n');
    });
});

describe('valueSource', () => {
    it('gives a value as YAML', () => {
        expect(valueSource('meta:\n  Status: Done\n  Lang: Rust\n', ['meta'])).toBe('Status: Done\nLang: Rust');
        expect(valueSource('topic: Ethics\n', ['topic'])).toBe('Ethics');
    });
});
