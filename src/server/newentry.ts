import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import type { FieldSchema, ResolvedCollection } from '../types.ts';

/**
 * `POST /new`: a new entry from a title. The file name is the title as a slug; the frontmatter is the
 * site's `newEntry(title)` template, with any field the schema requires and the template leaves out
 * filled with an empty value of its type.
 */

export function slugify(title: string): string {
    return (
        title
            .normalize('NFKD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/['’]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80)
            .replace(/-+$/, '') || 'untitled'
    );
}

const pad = (n: number) => String(n).padStart(2, '0');
/** A date as the entries write it: `2026-10-27`, in local time. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** An empty value for a required field the template doesn't set. */
function emptyFor(field: FieldSchema, today: Date): unknown {
    const type = Array.isArray(field.type) ? field.type[0] : field.type;
    if (field.enum?.length) return field.enum[0];
    if (field.format === 'date' || field.format === 'date-time') return isoDay(today);
    if (type === 'string') return '';
    if (type === 'number' || type === 'integer') return field.minimum ?? 0;
    if (type === 'boolean') return false;
    if (type === 'array') return [];
    if (field.anyOf) return emptyFor(field.anyOf[0], today);
    return undefined;
}

/** The new file's text: frontmatter, then an empty body. */
export function newEntryText(
    title: string,
    template: ((title: string) => Record<string, unknown>) | undefined,
    schema: FieldSchema | null,
    today = new Date()
): string {
    const data: Record<string, unknown> = { title, ...template?.(title) };
    for (const key of schema?.required ?? []) {
        if (key in data) continue;
        const value = emptyFor(schema!.properties?.[key] ?? {}, today);
        if (value !== undefined) data[key] = value;
    }
    for (const [k, v] of Object.entries(data)) if (v instanceof Date) data[k] = isoDay(v);
    // Plain `key: value` lines, without the folding the yaml package does to long strings.
    return `---\n${stringify(data, { lineWidth: 0 })}---\n\n`;
}

/** Write the entry, numbering the slug if it's taken. Returns its id. */
export async function createEntry(collection: ResolvedCollection, title: string, text: string): Promise<string> {
    const base = slugify(title);
    for (let n = 1; ; n++) {
        const id = n === 1 ? base : `${base}-${n}`;
        const path = join(collection.dir, `${id}.mdx`);
        try {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, text, { flag: 'wx' });
            return id;
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        }
    }
}
