import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkOptions } from '../../src/server/options.ts';

let root: string;

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'mdx-editor-options-'));
    await mkdir(join(root, 'src/content/blog'), { recursive: true });
    await mkdir(join(root, 'src/mdx-editor'), { recursive: true });
    await writeFile(join(root, 'src/mdx-editor/Shell.astro'), '<slot />');
    await writeFile(join(root, 'src/mdx-editor/globals.ts'), 'export {};');
});

const errors = (value: unknown) => checkOptions(value, root).errors;

describe('checkOptions', () => {
    it('accepts no options and full options', () => {
        expect(checkOptions(undefined, root)).toEqual({ errors: [], warnings: [] });
        expect(errors({})).toEqual([]);
        expect(
            checkOptions(
                {
                    shell: './src/mdx-editor/Shell.astro',
                    globals: './src/mdx-editor/globals.ts',
                    collections: {
                        blog: { pageUrl: (id: string) => `/blog/${id}/`, newEntry: (title: string) => ({ title }) },
                    },
                    typography: { quotes: false },
                    keymap: { 'format.bold': 'Mod-Shift-b' },
                    callouts: ['note'],
                    emoji: false,
                    images: { dir: 'src/assets', snippet: () => '' },
                },
                root
            )
        ).toEqual({ errors: [], warnings: [] });
    });

    it('names unknown options, with a near match', () => {
        expect(errors({ collection: {} })).toEqual(['unknown option `collection`; did you mean `collections`?']);
        expect(errors({ collections: { blog: { url: () => '' } } })[0]).toMatch(
            /^unknown option `collections\.blog\.url`; expected one of dir, pageUrl/
        );
    });

    it('checks the shell and globals exist', () => {
        expect(errors({ shell: './src/Missing.astro' })).toEqual(["`shell`: ./src/Missing.astro doesn't exist"]);
        expect(errors({ shell: './src/mdx-editor/globals.ts' })).toEqual([
            '`shell` must be an .astro component, got ./src/mdx-editor/globals.ts',
        ]);
        expect(errors({ shell: 42 })).toEqual(['`shell` must be a path relative to the project, got 42']);
    });

    it('checks collections and their functions', () => {
        expect(errors({ collections: ['blog'] })[0]).toMatch(/^`collections` must be an object like \{ blog: \{\} \}/);
        expect(errors({ collections: { blog: true } })[0]).toMatch(/^`collections\.blog` must be an object/);
        expect(errors({ collections: { blog: { pageUrl: '/blog/' } } })[0]).toMatch(
            /^`collections\.blog\.pageUrl` must be a function/
        );
    });

    it('warns about a collection folder that does not exist', () => {
        expect(checkOptions({ collections: { notes: {} } }, root)).toEqual({
            errors: [],
            warnings: ["`collections.notes`: src/content/notes doesn't exist yet"],
        });
    });

    it('rejects options that are not an object', () => {
        expect(errors('blog')).toEqual(['the options must be an object, got "blog"']);
    });
});
