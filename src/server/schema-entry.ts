/**
 * Runs inside the site's Vite SSR module runner (imported by src/server/schema.ts), so the content
 * config loads the way Astro loads it, with the site's own zod.
 */
import { z } from 'astro/zod';

type Json = Record<string, unknown>;

export async function jsonSchema(configPath: string, collection: string): Promise<Json | null> {
    const mod = await import(/* @vite-ignore */ configPath);
    let schema = mod.collections?.[collection]?.schema;
    // `schema: ({ image }) => …`: an image field is written in frontmatter as a path.
    if (typeof schema === 'function') schema = schema({ image: () => z.string() });
    if (!schema) return null;
    return z.toJSONSchema(schema, {
        io: 'input',
        unrepresentable: 'any',
        override: (ctx) => {
            const def = (ctx.zodSchema as { _zod?: { def?: { type?: string } } })._zod?.def;
            // Dates are written as YAML dates (`2026-10-21`).
            if (def?.type === 'date') Object.assign(ctx.jsonSchema, { type: 'string', format: 'date' });
        },
    }) as Json;
}
