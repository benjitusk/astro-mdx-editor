/**
 * Runs inside the site's Vite SSR module runner (imported by src/server/render.ts), so
 * `astro/container`, the MDX renderer and the components share one Astro runtime with the dev server,
 * and snippets go through the site's real MDX pipeline.
 */
import mdxRenderer from '@astrojs/mdx/server.js';
import { experimental_AstroContainer } from 'astro/container';
import * as globals from 'virtual:mdx-editor/globals';

let container: experimental_AstroContainer | undefined;

/** A UI framework's server renderer (`@astrojs/react/server.js`…), by absolute path. */
export interface FrameworkRenderer {
    name: string;
    entry: string;
}

export async function render(file: string, frameworks: FrameworkRenderer[] = []): Promise<string> {
    if (!container) {
        container = await experimental_AstroContainer.create();
        // A fresh container doesn't inherit the site's renderers; MDX content needs this one, and
        // framework components (React…) need theirs. They render to static HTML: nothing hydrates.
        container.addServerRenderer({ name: 'astro:jsx', renderer: mdxRenderer });
        for (const f of frameworks)
            container.addServerRenderer({ name: f.name, renderer: (await import(/* @vite-ignore */ f.entry)).default });
    }
    const mod = await import(/* @vite-ignore */ file);
    return container.renderToString(mod.Content ?? mod.default, { props: { components: { ...globals } } });
}
