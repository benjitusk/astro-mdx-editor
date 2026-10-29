import { describe, expect, it } from 'vitest';
import { anchorsFrom, mapY, syncedScroll } from '../../src/client/scrollsync.ts';
import { blockOffsets } from '../../src/client/textmap.ts';

describe('blockOffsets', () => {
    const source =
        '---\ntitle: A post\n---\n\n## First part\n\nSome **bold** words in a paragraph.\n\n- An item [linked](/x)\n';

    it('finds each block where its text starts', () => {
        const offsets = blockOffsets(source, ['First part', 'Some bold words in a paragraph.', 'An item linked']);
        expect(offsets.map((o) => source.slice(o!, o! + 5))).toEqual(['First', 'Some ', 'An it']);
    });
    it('skips text that is not in the source, too short, or not unique', () => {
        const src = 'A sentence repeated.\n\nA sentence repeated.\n\nUnique words here.';
        expect(
            blockOffsets(src, ['Site navigation menu', 'Home', 'A sentence repeated.', 'Unique words here.'])
        ).toEqual([null, null, null, src.indexOf('Unique')]);
    });
    it('keeps a longer prefix when the start alone is repeated', () => {
        const lead = 'This opening phrase is the same in both of them, ';
        const src = `${lead}until here.\n\n${lead}but not here.`;
        expect(blockOffsets(src, [`${lead}but not here.`])).toEqual([src.lastIndexOf(lead)]);
    });
    it('drops blocks out of source order', () => {
        const src = 'The first paragraph.\n\nThe second paragraph.\n\nThe third paragraph.';
        const offsets = blockOffsets(src, [
            'The first paragraph.',
            'The third paragraph.',
            'The second paragraph.',
            'The third paragraph.',
        ]);
        // Either the second or the first "third" goes; the run kept is in order.
        expect(offsets.filter((o) => o !== null)).toEqual([0, src.indexOf('The second'), src.indexOf('The third')]);
    });
});

describe('scroll mapping', () => {
    const anchors = anchorsFrom(
        [
            [100, 300],
            [50, 400], // goes backwards in the editor: dropped
            [500, 700],
        ],
        1000,
        2000
    );

    it('builds anchors from top to bottom, increasing on both sides', () => {
        expect(anchors).toEqual([
            [0, 0],
            [100, 300],
            [500, 700],
            [1000, 2000],
        ]);
    });
    it('interpolates between anchors, both ways', () => {
        expect(mapY(anchors, 300, 0)).toBe(500);
        expect(mapY(anchors, 500, 1)).toBe(300);
        expect(mapY(anchors, 750, 0)).toBe(1350);
        expect(mapY(anchors, 5000, 0)).toBe(2000);
    });
    it('lines up the tops and the ends', () => {
        const editor = (top: number) => ({ top, max: 600, height: 1000 });
        const page = { top: 0, max: 1600, height: 2000 };
        expect(syncedScroll(editor(0), page, anchors, 0)).toBe(0);
        expect(syncedScroll(editor(600), page, anchors, 0)).toBe(1600);
        expect(syncedScroll({ ...page, top: 1600 }, editor(0), anchors, 1)).toBe(600);
    });
    it('leaves a page with nothing to scroll at the top', () => {
        expect(syncedScroll({ top: 0, max: 0, height: 500 }, { top: 0, max: 100, height: 600 }, anchors, 0)).toBe(0);
    });
});
