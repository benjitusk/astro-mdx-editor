import { describe, expect, it } from 'vitest';
import { countLabel, countWords, currentBlock, headings } from '../../src/client/writing.ts';
import { view } from './helpers.ts';

describe('word count', () => {
    it('counts prose only', () => {
        const v = view(
            "---\ntitle: Many words in the title\n---\n\nimport A from './a';\n\nOne **two** `code` three's.\n\n<Note kind='a b c'>\n\nFour five.\n\n</Note>\n\n```js\nnot counted\n```\n\n## Six\n\n\\[seven\\](http://x.y/z)|"
        );
        expect(countWords(v.state)).toBe(7);
        expect(countLabel(v.state)).toBe('7 words · 1 min');
    });
});

describe('outline and focus', () => {
    it('lists headings, not the frontmatter', () => {
        const v = view('---\ntitle: x\n---\n\n# One\n\nText\n\nTwo\n---\n\n### Three ###\n|');
        expect(headings(v.state).map((x) => [x.level, x.text])).toEqual([
            [1, 'One'],
            [2, 'Two'],
            [3, 'Three'],
        ]);
    });
    it('finds the block being written', () => {
        const v = view('First.\n\nSecond |paragraph\nstill.\n\n- item');
        const b = currentBlock(v.state);
        expect(v.state.sliceDoc(b.from, b.to)).toBe('Second paragraph\nstill.');
    });
});
