import type { AstroConfig, AstroIntegration } from 'astro';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountApi } from './server/api.ts';
import { loadEmojiTable, type EmojiTable } from './server/emoji.ts';
import { discoverCollections, entryForPath, listEntries, resolveCollections } from './server/entries.ts';
import { checkOptions } from './server/options.ts';
import { answerPageQueries, TOOLBAR_APP_ID } from './server/pages.ts';
import { routeFullReloads } from './server/reload.ts';
import { createRegistry } from './server/registry.ts';
import { createRenderer } from './server/render.ts';
import type { FrameworkRenderer } from './server/render-entry.ts';
import { createSchemas } from './server/schema.ts';
import { siblingModule } from './server/modules.ts';
import { editorVitePlugin } from './server/vite-plugin.ts';
import type { ImageOptions, MdxEditorOptions, ResolvedCollection } from './types.ts';

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const page = (name: string) => fileURLToPath(new URL(`./pages/${name}`, import.meta.url));
/** The Shell when the site sets none: a plain page, without the site's layout. */
const defaultShell = fileURLToPath(new URL('./shell/DefaultShell.astro', import.meta.url));
/** Shown wherever a render would fail because the site has no MDX integration. */
/** The toolbar app's icon: a pencil, drawn like Astro's own (24px, currentColor). */
const EDIT_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16.86 4.49a2.1 2.1 0 0 1 2.97 2.97L8.25 19.04 4.5 19.5l.46-3.75z"/><path d="m15 6.35 2.65 2.65"/></svg>';
const NO_MDX =
    '@astrojs/mdx is not in the integrations, so components and HTML in entries can’t render here (Markdown still edits). Add it with `npx astro add mdx`.';

/**
 * The client's dependencies, which the site's dependency optimizer must leave alone: from a sibling
 * checkout they live in this package's node_modules, which it can't resolve from the site root, and
 * pre-bundling some CodeMirror packages but not others would load two copies of @codemirror/state.
 * They are all plain ES modules, so they are excluded and served as they are, one copy each.
 * Installed from npm they are usually hoisted into the site's node_modules, so every node_modules
 * folder Node would look in from here is scanned.
 */
function clientDependencies(): string[] {
    const lookup = createRequire(join(pkgRoot, 'package.json')).resolve.paths('x') ?? [];
    const names = new Set<string>();
    for (const modules of lookup) {
        for (const entry of safeReaddir(modules)) {
            if (entry.startsWith('.')) continue;
            if (entry.startsWith('@')) {
                for (const sub of safeReaddir(join(modules, entry))) names.add(`${entry}/${sub}`);
            } else names.add(entry);
        }
    }
    return [...names].filter((n) =>
        /^(@codemirror|@lezer|@marijn)\/|^(style-mod|w3c-keyname|crelt|turndown|yaml)$/.test(n)
    );
}

function safeReaddir(dir: string): string[] {
    try {
        return readdirSync(dir);
    } catch {
        return [];
    }
}

/** UI framework integrations whose components can appear in MDX, each with a `server.js` renderer. */
const FRAMEWORKS = ['@astrojs/react', '@astrojs/preact', '@astrojs/vue', '@astrojs/svelte', '@astrojs/solid-js'];

/** The site's framework renderers, resolved from the site (this package doesn't depend on them). */
function frameworkRenderers(config: AstroConfig, root: string): FrameworkRenderer[] {
    const require = createRequire(join(root, 'package.json'));
    return config.integrations
        .filter((i) => FRAMEWORKS.includes(i.name))
        .flatMap((i) => {
            try {
                return [{ name: i.name, entry: require.resolve(`${i.name}/server.js`) }];
            } catch {
                return [];
            }
        });
}

function hasMdx(config: AstroConfig): boolean {
    return config.integrations.some((i) => i.name === '@astrojs/mdx');
}

/** A collection's image settings: its own, else the top-level ones, else the defaults. Null when off. */
export function imageOptions(options: MdxEditorOptions, collection: string): ImageOptions | null {
    const own = options.collections?.[collection]?.images;
    const value = own ?? options.images;
    return value === false ? null : (value ?? {});
}

export default function mdxEditor(siteOptions: MdxEditorOptions = {}): AstroIntegration {
    // A fresh token per dev-server start; it is only ever served inside the editor page.
    const token = randomBytes(24).toString('hex');
    // The site's options with the defaults filled in, once the project root is known.
    let options: MdxEditorOptions = siteOptions;
    let collections: ResolvedCollection[] = [];
    let config: AstroConfig;
    let active = false;

    return {
        name: 'astro-mdx-editor',
        hooks: {
            'astro:config:setup': ({ command, config, injectRoute, addDevToolbarApp, updateConfig, logger }) => {
                if (command !== 'dev') return;
                const root = fileURLToPath(config.root);
                // Bad options turn the editor off, never the site's dev server.
                const { errors, warnings } = checkOptions(siteOptions, root);
                if (errors.length) {
                    logger.error(
                        `The editor is off until its options are fixed:\n${errors.map((e) => `  - ${e}`).join('\n')}`
                    );
                    return;
                }
                for (const warning of warnings) logger.warn(warning);
                active = true;

                const named = siteOptions.collections ?? discoverCollections(root);
                const names = Object.keys(named);
                if (!siteOptions.collections) {
                    if (names.length)
                        logger.info(`Editing ${names.join(', ')} (from src/content/); set \`collections\` to choose.`);
                    else
                        logger.warn(
                            'No collections to edit: no folder in src/content/ has .md or .mdx files. Add one, or set `collections`.'
                        );
                }
                if (!siteOptions.shell)
                    logger.info(
                        'Entries open on a plain page; set `shell` to edit them inside your layout (see the README).'
                    );
                options = { ...siteOptions, collections: named };
                collections = resolveCollections(root, named);
                (globalThis as Record<symbol, unknown>)[Symbol.for('astro-mdx-editor')] = { options };

                injectRoute({ pattern: '/__edit', entrypoint: page('index.astro'), prerender: false });
                injectRoute({
                    pattern: '/__edit/[collection]/[...id]',
                    entrypoint: page('edit.astro'),
                    prerender: false,
                });
                addDevToolbarApp({
                    id: TOOLBAR_APP_ID,
                    name: 'Edit this page',
                    icon: EDIT_ICON,
                    entrypoint: siblingModule('./client/toolbar', import.meta.url),
                });
                updateConfig({
                    vite: {
                        plugins: [
                            editorVitePlugin({
                                options,
                                token,
                                shell: options.shell ? resolve(root, options.shell) : defaultShell,
                                globals: options.globals ? resolve(root, options.globals) : null,
                                collections,
                                serverModule: siblingModule('./server/entries', import.meta.url),
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
            'astro:config:done': ({ config: done, logger }) => {
                config = done;
                if (active && !hasMdx(done)) logger.error(NO_MDX);
            },
            'astro:server:setup': ({ server }) => {
                if (!active) return;
                const root = fileURLToPath(config.root);
                let emoji: Promise<EmojiTable | null> | undefined;
                mountApi(server, {
                    token,
                    root,
                    collections,
                    images: (name) => imageOptions(options, name),
                    newEntry: (name) => options.collections?.[name]?.newEntry,
                    renderer: createRenderer(
                        server,
                        root,
                        frameworkRenderers(config, root),
                        hasMdx(config) ? null : NO_MDX
                    ),
                    schemas: createSchemas(server, root),
                    registry: createRegistry(server, root, options.globals ? resolve(root, options.globals) : null),
                    emoji: () => {
                        if (options.emoji === false) return Promise.resolve(null);
                        return (emoji ??= loadEmojiTable(root, options.emoji ?? {}));
                    },
                });
                answerPageQueries(
                    server,
                    () => listEntries(collections),
                    (collection, id) => options.collections?.[collection]?.pageUrl?.(id) ?? null
                );
                // Astro rewrites .astro/data-store.json after every content change; that is not code.
                const generated = join(root, '.astro') + sep;
                routeFullReloads(
                    server,
                    (path) => entryForPath(collections, path) !== null || path.startsWith(generated)
                );
            },
        },
    };
}
