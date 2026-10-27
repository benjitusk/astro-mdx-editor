import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { entryForPath, findEntry, listEntries, resolveCollections } from '../../src/server/entries.ts';

let root: string;
let collections: ReturnType<typeof resolveCollections>;

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'mdx-editor-'));
    await mkdir(join(root, 'src/content/essays/nested'), { recursive: true });
    await writeFile(join(root, 'src/content/essays/one.mdx'), 'one');
    await writeFile(join(root, 'src/content/essays/nested/two.md'), 'two');
    await writeFile(join(root, 'package.json'), '{}');
    collections = resolveCollections(root, { essays: {} });
});

describe('entries', () => {
    it('finds .mdx and .md entries, nested too', async () => {
        expect((await findEntry(collections, 'essays', 'one'))?.path).toBe(join(root, 'src/content/essays/one.mdx'));
        expect((await findEntry(collections, 'essays', 'nested/two'))?.path).toMatch(/two\.md$/);
    });
    it('refuses ids that escape the collection folder', async () => {
        expect(await findEntry(collections, 'essays', '../../../package')).toBeNull();
        expect(await findEntry(collections, 'essays', '/etc/passwd')).toBeNull();
        expect(await findEntry(collections, 'nope', 'one')).toBeNull();
    });
    it('maps changed files back to entries', () => {
        expect(entryForPath(collections, join(root, 'src/content/essays/nested/two.md'))).toMatchObject({
            id: 'nested/two',
        });
        expect(entryForPath(collections, join(root, 'src/other.mdx'))).toBeNull();
    });
    it('lists every entry', async () => {
        expect((await listEntries(collections)).map((e) => e.id)).toEqual(['nested/two', 'one']);
    });
});
