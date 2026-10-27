/**
 * Runs inside the site's Vite SSR module runner (imported by src/server/render.ts), so
 * `astro/container`, the MDX renderer and the components share one Astro runtime with the dev server,
 * and snippets go through the site's real MDX pipeline.
 */
import mdxRenderer from '@astrojs/mdx/server.js';
import { experimental_AstroContainer } from 'astro/container';
import * as globals from 'virtual:mdx-editor/globals';

let container: experimental_AstroContainer | undefined;

export async function render(file: string): Promise<string> {
    if (!container) {
        container = await experimental_AstroContainer.create();
        // A fresh container doesn't inherit the site's renderers; MDX content needs this one.
        container.addServerRenderer({ name: 'astro:jsx', renderer: mdxRenderer });
    }
    const mod = await import(/* @vite-ignore */ file);
    return container.renderToString(mod.Content ?? mod.default, { props: { components: { ...globals } } });
}
