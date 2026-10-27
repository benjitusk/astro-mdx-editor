import { describe, expect, it } from 'vitest';
import { insertImages, placeAt } from '../../src/client/images.ts';
import { imageUrl, livePreview } from '../../src/client/livepreview.ts';
import type { UploadResult } from '../../src/types.ts';
import { marked, view } from './helpers.ts';

const md = (alt: string): UploadResult => {
    const markup = `![${alt}](./a.png)`;
    return { file: 'a.png', markup, imports: [], alt: [2, 2 + alt.length] };
};
const figure: UploadResult = {
    file: 'a.png',
    markup: '<Figure src={a} alt="" />',
    imports: ["import Figure from '../C/Figure.astro';", "import a from './a.png';"],
    alt: [21, 21],
};

const insert = (src: string, results: UploadResult[]) => {
    const v = view(src);
    insertImages(v, v.state.selection.main.head, results);
    return marked(v);
};

describe('inserting images', () => {
    it('goes on a blank line, with blank lines around it, and selects the alt text', () => {
        expect(insert('One.\n|\nTwo.', [md('a sketch')])).toBe('One.\n\n![[a sketch]](./a.png)\n\nTwo.');
    });
    it('goes after the line when the cursor is in text', () => {
        expect(insert('One |two.\nThree.', [md('')])).toBe('One two.\n\n![|](./a.png)\n\nThree.');
        expect(insert('Last |line.', [md('x'), md('y')])).toBe('Last line.\n\n![[x]](./a.png)\n\n![y](./a.png)');
    });
    it('adds only the import lines the entry lacks', () => {
        const out = insert('---\nt: 1\n---\n\nimport Figure from "../C/Figure.astro"\n\nText|', [figure]);
        expect(out).toBe(
            '---\nt: 1\n---\n\nimport Figure from "../C/Figure.astro"\nimport a from \'./a.png\';\n\nText\n\n<Figure src={a} alt="|" />'
        );
    });
});

describe('placeAt', () => {
    it('moves a drop on a tag to after the element, and one on the imports below them', () => {
        const v = view('<Figure\n    src={a}\n/>\n\n<Note>\n\nIn.\n\n</Note>');
        expect(placeAt(v.state, 10)).toBe(22);
        const inner = v.state.doc.toString().indexOf('In.');
        expect(placeAt(v.state, inner + 1)).toBe(inner + 1);
        const w = view("import a from './a';\nimport b from './b';\n\nBody");
        expect(placeAt(w.state, 3)).toBe(41);
    });
});

describe('image preview', () => {
    const widgets = (src: string) => {
        const v = view(src);
        const out: { from: number; to: number; below: boolean }[] = [];
        v.state.field(livePreview).decorations.between(0, v.state.doc.length, (from, to, d) => {
            const w = d.spec.widget as { below?: boolean; src?: string } | undefined;
            if (w && 'below' in w) out.push({ from, to, below: w.below! });
        });
        return out;
    };
    it('replaces the source off-cursor and shows the image under it on-cursor', () => {
        expect(widgets('!\\[A\\](./a.png)\n\nText|')).toEqual([{ from: 0, to: 13, below: false }]);
        expect(widgets('!\\[A|\\](./a.png)\n\nText')).toEqual([{ from: 13, to: 13, below: true }]);
    });
    it('resolves relative paths against the entry folder', () => {
        expect(imageUrl('../../assets/x/a b.png', '/@fs/site/src/content/essays/')).toBe(
            '/@fs/site/src/assets/x/a%20b.png'
        );
        expect(imageUrl('https://e.com/a.png', '/@fs/x/')).toBe('https://e.com/a.png');
        expect(imageUrl('/og.png', '/@fs/x/')).toBe('/og.png');
    });
});
