import { describe, expect, it } from 'vitest';
import { sourceOffsetFor } from '../../src/client/textmap.ts';

/** Click just before `word` in the rendered text; return the source from the mapped offset. */
const click = (source: string, rendered: string, word: string, nth = 0) => {
    let at = -1;
    for (let i = 0; i <= nth; i++) at = rendered.indexOf(word, at + 1);
    const off = sourceOffsetFor(source, rendered, at);
    return off === null ? null : source.slice(off, off + word.length);
};

describe('sourceOffsetFor', () => {
    const source =
        "<Define word='judge'>\n\n1. To form an opinion or **conclusion** about\n2. To give verdict on (someone) in court\n\n</Define>";
    const rendered =
        'judge Apple Dictionary To form an opinion or conclusion about To give verdict on (someone) in court';

    it('finds plain text past list markers', () => {
        expect(click(source, rendered, 'form an')).toBe('form an');
        expect(click(source, rendered, 'verdict')).toBe('verdict');
    });
    it('sees through emphasis markers', () => {
        expect(click(source, rendered, 'conclusion')).toBe('conclusion');
        expect(click(source, rendered, 'about')).toBe('about');
    });
    it('returns null for component chrome that is not in the source', () => {
        expect(click(source, rendered, 'Apple')).toBeNull();
    });
    it('matches curly quotes in the render to straight ones in the source', () => {
        expect(click('He said "don\'t" twice.', 'He said “don’t” twice.', 'twice')).toBe('twice');
    });
    it('ignores link targets', () => {
        expect(click('See [the docs](https://x.y/z) for more.', 'See the docs for more.', 'docs')).toBe('docs');
        expect(click('See [the docs](https://x.y/z) for more.', 'See the docs for more.', 'for more')).toBe('for more');
    });
    it('picks the occurrence nearest the click for repeated text', () => {
        const src = 'a word here and filler filler filler and a word here';
        expect(sourceOffsetFor(src, src, src.lastIndexOf('a word'))).toBe(src.lastIndexOf('a word'));
    });
});
