import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ViteDevServer } from 'vite';
import type { EntryFile } from './entries.ts';

const renderEntry = fileURLToPath(new URL('./render-entry.ts', import.meta.url));

export type RenderResult = { html: string } | { error: string };

/** The file's MDX `import` statements (outside code fences), which a rendered block may need. */
export function importLines(text: string): string[] {
    const out: string[] = [];
    let fence = false;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
        if (fence || !/^import\s/.test(lines[i])) continue;
        let j = i;
        while (j + 1 < lines.length && lines[j + 1].trim() !== '' && !/^(import|export)\s/.test(lines[j + 1])) j++;
        out.push(lines.slice(i, j + 1).join('\n'));
        i = j;
    }
    return out;
}

/** Point relative import specifiers at absolute paths: the snippet lives somewhere else. */
export function absoluteImports(imports: string[], fromDir: string): string[] {
    return imports.map((stmt) =>
        stmt.replace(
            /(\bfrom\s*|\bimport\s*)(['"])(\.{1,2}\/[^'"]+)\2/g,
            (_m, kw, q, spec) => `${kw}${q}${resolve(fromDir, spec)}${q}`
        )
    );
}

/**
 * Renders one block of an entry's MDX through the site's own pipeline. The block is written, with the
 * entry's imports, to a snippet file named by its content hash (written once, so an unchanged block
 * never touches the module graph), loaded through Vite's SSR runner and rendered with the Container
 * API. Results are cached by hash.
 */
export function createRenderer(server: ViteDevServer, root: string) {
    const dir = join(root, 'node_modules', '.mdx-editor', 'snippets');
    const cache = new Map<string, Promise<RenderResult>>();

    async function renderSnippet(snippet: string): Promise<RenderResult> {
        const hash = createHash('sha1').update(snippet).digest('hex').slice(0, 16);
        const file = join(dir, `${hash}.mdx`);
        if (!existsSync(file)) {
            await mkdir(dir, { recursive: true });
            await writeFile(file, snippet);
        }
        try {
            const runner = server.environments.ssr as unknown as { runner: { import: (id: string) => Promise<any> } };
            const { render } = await runner.runner.import(renderEntry);
            return { html: await render(file) };
        } catch (e) {
            const err = e as Error & { loc?: { line?: number } };
            return { error: (err.message ?? String(e)).split('\n')[0] };
        }
    }

    async function render(entry: EntryFile, source: string): Promise<RenderResult> {
        const text = await readFile(entry.path, 'utf8');
        const imports = absoluteImports(importLines(text), dirname(entry.path));
        const snippet = (imports.length ? imports.join('\n') + '\n\n' : '') + source + '\n';
        let result = cache.get(snippet);
        if (!result) {
            result = renderSnippet(snippet);
            cache.set(snippet, result);
            // Don't cache failures: the cause may be a component that's being fixed.
            void result.then((r) => 'error' in r && cache.delete(snippet));
        }
        return result;
    }

    // A component (or anything it imports) changed: every cached render may be stale.
    const invalidate = () => cache.clear();
    return { render, invalidate };
}
