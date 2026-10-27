import type { AstroConfig, AstroIntegration } from 'astro';
import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountApi } from './server/api.ts';
import { entryForPath, resolveCollections } from './server/entries.ts';
import { routeFullReloads } from './server/reload.ts';
import { editorVitePlugin } from './server/vite-plugin.ts';
import type { MdxEditorOptions, ResolvedCollection } from './types.ts';

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const page = (name: string) => fileURLToPath(new URL(`./pages/${name}`, import.meta.url));

/**
 * The client's dependencies live in this package's node_modules, which the site's dependency
 * optimizer can't resolve from the site root. They are all plain ES modules, so they are excluded
 * from optimizing and served as they are (one copy each, from here).
 */
function clientDependencies(): string[] {
    const modules = join(pkgRoot, 'node_modules');
    const names: string[] = [];
    for (const entry of safeReaddir(modules)) {
        if (entry.startsWith('.')) continue;
        if (entry.startsWith('@')) {
            for (const sub of safeReaddir(join(modules, entry))) names.push(`${entry}/${sub}`);
        } else names.push(entry);
    }
    return names.filter((n) => /^(@codemirror|@lezer|@marijn)\/|^(style-mod|w3c-keyname|crelt|turndown)$/.test(n));
}

function safeReaddir(dir: string): string[] {
    try {
        return readdirSync(dir);
    } catch {
        return [];
    }
}

export default function mdxEditor(options: MdxEditorOptions): AstroIntegration {
    // A fresh token per dev-server start; it is only ever served inside the editor page.
    const token = randomBytes(24).toString('hex');
    let collections: ResolvedCollection[] = [];
    let config: AstroConfig;
    let active = false;

    return {
        name: 'astro-mdx-editor',
        hooks: {
            'astro:config:setup': ({ command, config, injectRoute, updateConfig, logger }) => {
                if (command !== 'dev') return;
                active = true;
                const root = fileURLToPath(config.root);
                collections = resolveCollections(root, options.collections);
                (globalThis as Record<symbol, unknown>)[Symbol.for('astro-mdx-editor')] = { options };

                injectRoute({ pattern: '/__edit', entrypoint: page('index.astro'), prerender: false });
                injectRoute({
                    pattern: '/__edit/[collection]/[...id]',
                    entrypoint: page('edit.astro'),
                    prerender: false,
                });
                updateConfig({
                    vite: {
                        plugins: [
                            editorVitePlugin({
                                options,
                                token,
                                shell: resolve(root, options.shell),
                                globals: options.globals ? resolve(root, options.globals) : null,
                                collections,
                                serverModule: fileURLToPath(new URL('./server/entries.ts', import.meta.url)),
                            }),
                        ],
                        // The package lives outside the site (npm link / file:), so its files need
                        // serving, and Astro and MDX must resolve to the site's copies, never ours.
                        server: { fs: { allow: [root, pkgRoot] } },
                        resolve: { dedupe: ['astro', '@astrojs/mdx'] },
                        optimizeDeps: { exclude: clientDependencies() },
                    },
                });
                logger.info('Editor at /__edit');
            },
            'astro:config:done': ({ config: done }) => {
                config = done;
            },
            'astro:server:setup': ({ server }) => {
                if (!active) return;
                mountApi(server, { token, collections });
                // Astro rewrites .astro/data-store.json after every content change; that is not code.
                const generated = join(fileURLToPath(config.root), '.astro') + sep;
                routeFullReloads(
                    server,
                    (path) => entryForPath(collections, path) !== null || path.startsWith(generated)
                );
            },
        },
    };
}
