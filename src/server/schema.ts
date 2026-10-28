import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type ts from 'typescript';
import type { ViteDevServer } from 'vite';
import type { CollectionSchema } from '../types.ts';
import { siblingModule } from './modules.ts';

/**
 * `GET /schema`: a collection's frontmatter schema as JSON Schema (converted from the site's zod
 * schema inside the dev server), plus the JSDoc written above each field in the content config,
 * keyed by dotted path. Fields documented with comments rather than `.describe()` get their docs too.
 */

const CONFIGS = ['src/content.config.ts', 'src/content.config.mjs', 'src/content.config.js', 'src/content/config.ts'];

export function createSchemas(server: ViteDevServer, root: string) {
    const entry = siblingModule('./schema-entry', import.meta.url);
    const config = CONFIGS.map((c) => join(root, c)).find((p) => existsSync(p)) ?? null;

    async function schema(collection: string): Promise<CollectionSchema | null> {
        if (!config) return null;
        const runner = server.environments.ssr as unknown as { runner: { import: (id: string) => Promise<any> } };
        const { jsonSchema } = await runner.runner.import(entry);
        const json = await jsonSchema(config, collection);
        if (!json) return null;
        const t = (await import('typescript')).default as typeof ts;
        return { schema: json, docs: fieldDocs(t, await readFile(config, 'utf8'), collection) };
    }
    return { schema };
}

/** JSDoc above each schema field of a collection in a content config, by dotted path. */
export function fieldDocs(t: typeof ts, text: string, collection: string): Record<string, string> {
    const src = t.createSourceFile('content.config.ts', text, t.ScriptTarget.Latest, true, t.ScriptKind.TS);
    const docs: Record<string, string> = {};

    // `export const collections = { essays }` or `{ essays: x }` → the `defineCollection(…)` call.
    const variables = new Map<string, ts.Expression>();
    let call: ts.Expression | undefined;
    const visit = (n: ts.Node) => {
        if (t.isVariableDeclaration(n) && t.isIdentifier(n.name) && n.initializer)
            variables.set(n.name.text, n.initializer);
        t.forEachChild(n, visit);
    };
    visit(src);
    const collections = variables.get('collections');
    if (collections && t.isObjectLiteralExpression(collections)) {
        for (const p of collections.properties) {
            const name = p.name && (t.isIdentifier(p.name) || t.isStringLiteral(p.name)) ? p.name.text : null;
            if (name !== collection) continue;
            if (t.isShorthandPropertyAssignment(p)) call = variables.get(p.name.text);
            else if (t.isPropertyAssignment(p))
                call = t.isIdentifier(p.initializer) ? variables.get(p.initializer.text) : p.initializer;
        }
    }
    if (!call || !t.isCallExpression(call) || !call.arguments[0] || !t.isObjectLiteralExpression(call.arguments[0]))
        return docs;
    const schemaProp = call.arguments[0].properties.find(
        (p): p is ts.PropertyAssignment => t.isPropertyAssignment(p) && p.name.getText(src) === 'schema'
    );
    if (!schemaProp) return docs;

    const walk = (n: ts.Node, path: string) => {
        if (t.isPropertyAssignment(n) && (t.isIdentifier(n.name) || t.isStringLiteral(n.name))) {
            const key = path ? `${path}.${n.name.text}` : n.name.text;
            const ranges = t.getLeadingCommentRanges(text, n.getFullStart()) ?? [];
            const jsdoc = ranges.filter((r) => text.startsWith('/**', r.pos)).at(-1);
            if (jsdoc) {
                docs[key] = text
                    .slice(jsdoc.pos + 3, jsdoc.end - 2)
                    .split('\n')
                    .map((l) => l.replace(/^\s*\*? ?/, ''))
                    .join('\n')
                    .trim()
                    .replace(/\s*\n\s*/g, ' ');
            }
            walk(n.initializer, key);
            return;
        }
        t.forEachChild(n, (c) => walk(c, path));
    };
    walk(schemaProp.initializer, '');
    return docs;
}
