import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { fieldDocs } from '../../src/server/schema.ts';

describe('fieldDocs', () => {
    it('reads the JSDoc above each field of the named collection, nested fields by path', () => {
        const src = `import { z } from 'astro/zod';
const other = defineCollection({
    schema: z.object({
        /** Not this one. */
        title: z.string(),
    }),
});
const projects = defineCollection({
    loader: glob({ base: './x' }),
    schema: ({ image }) =>
        z.object({
            title: z.string(),
            /** Generated hero figure,
             *  used when there's no heroImage. */
            hero: z
                .object({
                    /** The pattern. */
                    motif: z.enum(['a']).optional(),
                })
                .optional(),
            // a line comment isn't docs
            number: z.string().optional(),
        }),
});
export const collections = { projects, other: other };
`;
        expect(fieldDocs(ts, src, 'projects')).toEqual({
            'hero': "Generated hero figure, used when there's no heroImage.",
            'hero.motif': 'The pattern.',
        });
        expect(fieldDocs(ts, src, 'other')).toEqual({ title: 'Not this one.' });
        expect(fieldDocs(ts, src, 'missing')).toEqual({});
    });
});
