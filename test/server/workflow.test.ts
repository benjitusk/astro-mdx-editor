import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitEntry, headVersion, referencedImages } from '../../src/server/git.ts';
import { createEntry, newEntryText, slugify } from '../../src/server/newentry.ts';
import type { FieldSchema } from '../../src/types.ts';

const schema: FieldSchema = {
    type: 'object',
    required: ['title', 'description', 'pubDate', 'topic'],
    properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        pubDate: { type: 'string', format: 'date' },
        topic: { enum: ['Ethics', 'Faith'] },
        draft: { type: 'boolean' },
    },
};
const day = new Date(2026, 9, 27, 15, 0);

describe('new entries', () => {
    it('slugs the title', () => {
        expect(slugify('Why can’t we pray? (Again)')).toBe('why-cant-we-pray-again');
        expect(slugify('???')).toBe('untitled');
    });
    it('writes the template, dates as days, and fills required fields it leaves out', () => {
        const text = newEntryText('A: B', (title) => ({ title, pubDate: day, draft: true }), schema, day);
        expect(text).toBe(
            '---\ntitle: "A: B"\npubDate: 2026-10-27\ndraft: true\ndescription: ""\ntopic: Ethics\n---\n\n'
        );
    });
    it('numbers a taken slug', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mdx-new-'));
        const c = { name: 'essays', dir };
        expect(await createEntry(c, 'Hello', 'x')).toBe('hello');
        expect(await createEntry(c, 'Hello', 'y')).toBe('hello-2');
        expect(await readFile(join(dir, 'hello.mdx'), 'utf8')).toBe('x');
    });
});

describe('git', () => {
    const git = (cwd: string, ...args: string[]) =>
        execFileSync('git', args, {
            cwd,
            encoding: 'utf8',
            env: {
                ...process.env,
                GIT_AUTHOR_NAME: 't',
                GIT_AUTHOR_EMAIL: 't@t',
                GIT_COMMITTER_NAME: 't',
                GIT_COMMITTER_EMAIL: 't@t',
            },
        });

    it('finds the images an entry points at', () => {
        const text = "import a from '../../assets/x/a.png';\n\n![b](../../assets/x/b%20c.jpg)\n\n[link](./notes.md)";
        expect(referencedImages(text, '/s/src/content/e/one.mdx').sort()).toEqual([
            '/s/src/assets/x/a.png',
            '/s/src/assets/x/b c.jpg',
        ]);
    });

    it('commits the entry and its new images, and nothing else', async () => {
        const root = await mkdtemp(join(tmpdir(), 'mdx-git-'));
        git(root, 'init', '-q');
        await mkdir(join(root, 'content'), { recursive: true });
        await mkdir(join(root, 'assets'), { recursive: true });
        const entry = join(root, 'content/one.mdx');
        await writeFile(entry, 'old\n');
        await writeFile(join(root, 'other.txt'), 'a\n');
        git(root, 'add', '-A');
        git(root, 'commit', '-qm', 'init');
        expect(await headVersion(entry)).toBe('old\n');

        const text = 'new\n\n![x](../assets/x.png)\n';
        await writeFile(entry, text);
        await writeFile(join(root, 'assets/x.png'), 'png');
        await writeFile(join(root, 'assets/unrelated.png'), 'png');
        await writeFile(join(root, 'other.txt'), 'b\n');
        git(root, 'add', 'other.txt'); // staged by someone else: must stay out of the commit

        const r = await commitEntry(entry, text, 'Write one');
        expect(r.files).toEqual(['content/one.mdx', 'assets/x.png']);
        expect(git(root, 'show', '--name-only', '--format=%s', 'HEAD').trim().split('\n')).toEqual([
            'Write one',
            '',
            'assets/x.png',
            'content/one.mdx',
        ]);
        expect(git(root, 'status', '--porcelain').trim().split('\n').sort()).toEqual([
            '?? assets/unrelated.png',
            'M  other.txt',
        ]);
    });
});
