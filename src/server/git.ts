import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

/**
 * `GET /diff` and `POST /commit`: the open entry against HEAD, and a commit of just that entry plus the
 * images it references that git doesn't have yet (or that changed). Nothing else in the index is
 * committed, and nothing is pushed.
 */

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await run('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
    return stdout;
}

async function repoOf(file: string): Promise<string> {
    return (await git(dirname(file), ['rev-parse', '--show-toplevel'])).trim();
}

const posix = (p: string) => p.split(sep).join('/');

/** A path relative to the repository, through any symlinks (git reports the real path of its root). */
const inRepo = async (top: string, path: string) => posix(relative(top, await realpath(path)));

/** The file as committed at HEAD, or null when it's new (or not in a repository). */
export async function headVersion(file: string): Promise<string | null> {
    try {
        const top = await repoOf(file);
        return await git(top, ['show', `HEAD:${await inRepo(top, file)}`]);
    } catch {
        return null;
    }
}

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

/** Local image files an entry's text points at: Markdown images and imported image files. */
export function referencedImages(text: string, file: string): string[] {
    const out = new Set<string>();
    const add = (spec: string) => {
        if (/^\.{1,2}\//.test(spec) && IMAGE.test(spec)) out.add(resolve(dirname(file), decodeURI(spec)));
    };
    for (const m of text.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)/g)) add(m[1]);
    for (const m of text.matchAll(/\bfrom\s+(['"])([^'"]+)\1/g)) add(m[2]);
    for (const m of text.matchAll(/\bsrc=(['"])([^'"]+)\1/g)) add(m[2]);
    return [...out];
}

export async function commitEntry(file: string, text: string, message: string) {
    const top = await repoOf(file);
    const images: string[] = [];
    for (const path of referencedImages(text, file)) {
        let rel: string;
        try {
            rel = await inRepo(top, path);
        } catch {
            continue; // not there
        }
        if (rel.startsWith('..')) continue;
        if ((await git(top, ['status', '--porcelain', '--', rel])).trim()) images.push(rel);
    }
    const files = [await inRepo(top, file), ...images];
    await git(top, ['add', '--', ...files]);
    // `--only` with paths: whatever else is staged stays staged and out of this commit.
    await git(top, ['commit', '--only', '-m', message, '--', ...files]);
    const commit = (await git(top, ['rev-parse', '--short', 'HEAD'])).trim();
    return { commit, files };
}
