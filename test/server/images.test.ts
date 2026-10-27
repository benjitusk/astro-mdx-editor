import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanName, identFor, imageDir, saveImage } from '../../src/server/images.ts';

let root: string;
const entry = () => ({
    collection: 'projects',
    id: 'solver-watchdog',
    path: join(root, 'src/content/projects/solver-watchdog.mdx'),
});
const png = (n: number) => ({ name: 'How Many Times.PNG', type: 'image/png', data: Buffer.from([n]), esm: '' });
const at = new Date(2026, 9, 27, 9, 5, 3);

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mdx-editor-img-'));
});

describe('naming', () => {
    it('cleans file names and makes one up for a pasted screenshot', () => {
        expect(cleanName('How Many Times.PNG', '.png')).toEqual({ base: 'how-many-times.png', made: false });
        expect(cleanName('Café — plan (v2).jpeg', '.jpg')).toEqual({ base: 'cafe-plan-v2.jpg', made: false });
        expect(cleanName('image.png', '.png', at)).toEqual({ base: 'image-20261027-090503.png', made: true });
        expect(cleanName('', '.png', at).made).toBe(true);
    });
    it('gives an import name that the entry does not use yet', () => {
        expect(identFor('how-many-times.jpg', '')).toBe('howManyTimes');
        expect(identFor('how-many-times.jpg', "import howManyTimes from './a.jpg';")).toBe('howManyTimes2');
        expect(identFor('2024-board.png', '')).toBe('img2024Board');
        expect(identFor('default.png', '')).toBe('imgDefault');
    });
    it('keeps the folder inside the project', () => {
        expect(imageDir(root, {}, entry())).toBe(join(root, 'src/assets/projects/solver-watchdog'));
        expect(imageDir(root, { dir: '../elsewhere/{id}' }, entry())).toBeNull();
        // Astro hands over the root with a trailing slash.
        expect(imageDir(`${root}/`, {}, entry())).toBe(join(root, 'src/assets/projects/solver-watchdog'));
    });
});

describe('saveImage', () => {
    it('saves into the folder and returns a Markdown image with its alt text marked', async () => {
        const r = await saveImage(root, { dir: 'src/assets/{collection}/{id}' }, entry(), png(1));
        expect(r.file).toBe('src/assets/projects/solver-watchdog/how-many-times.png');
        expect(r.markup).toBe('![how many times](../../assets/projects/solver-watchdog/how-many-times.png)');
        expect(r.markup.slice(...r.alt!)).toBe('how many times');
        expect(await readFile(join(root, r.file))).toEqual(Buffer.from([1]));
    });
    it('reuses an identical file and numbers a different one', async () => {
        const a = await saveImage(root, {}, entry(), png(1));
        const b = await saveImage(root, {}, entry(), png(1));
        const c = await saveImage(root, {}, entry(), png(2));
        expect(b.file).toBe(a.file);
        expect(c.file).toMatch(/how-many-times-2\.png$/);
        expect(c.markup).toContain('![how many times]');
        expect(await readdir(join(root, 'src/assets/projects/solver-watchdog'))).toHaveLength(2);
    });
    it('passes the site snippet an import name and keeps its import lines', async () => {
        const r = await saveImage(
            root,
            {
                dir: 'src/assets/projects/{id}',
                snippet: ({ path, alt, ident }) => ({
                    markup: `<Figure src={${ident}} alt="${alt}" />`,
                    imports: [`import Figure from '../../components/Figure.astro';`, `import ${ident} from '${path}';`],
                }),
            },
            entry(),
            { ...png(1), esm: "import howManyTimes from './old.jpg';" }
        );
        expect(r.markup).toBe('<Figure src={howManyTimes2} alt="how many times" />');
        expect(r.imports[1]).toBe(
            "import howManyTimes2 from '../../assets/projects/solver-watchdog/how-many-times.png';"
        );
    });
    it('gives a screenshot empty alt text, still marked, and refuses other types', async () => {
        const r = await saveImage(root, {}, entry(), { ...png(1), name: 'image.png' }, at);
        expect(r.markup).toBe('![](../../assets/projects/solver-watchdog/image-20261027-090503.png)');
        expect(r.alt).toEqual([2, 2]);
        await expect(saveImage(root, {}, entry(), { ...png(1), type: 'text/html' })).rejects.toThrow(/image type/);
    });
});
