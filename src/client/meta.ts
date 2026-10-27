import { StateField, type Text } from '@codemirror/state';

/** A span of whole lines, as document offsets. */
export interface Span {
    from: number;
    to: number;
}

export interface Meta {
    /** The YAML frontmatter, fences included. */
    frontmatter: Span | null;
    /** MDX `import` / `export` statements (each runs until a blank line). */
    esm: Span[];
}

/** Lezer's Markdown parser knows neither frontmatter nor MDX ESM, so find them by line. */
export function findMeta(doc: Text): Meta {
    let frontmatter: Span | null = null;
    let line = 1;
    if (doc.lines > 1 && doc.line(1).text === '---') {
        for (let i = 2; i <= doc.lines; i++) {
            if (doc.line(i).text === '---') {
                frontmatter = { from: 0, to: doc.line(i).to };
                line = i + 1;
                break;
            }
        }
    }
    const esm: Span[] = [];
    let inFence = false;
    for (let i = line; i <= doc.lines; i++) {
        const l = doc.line(i);
        if (/^\s*(```|~~~)/.test(l.text)) inFence = !inFence;
        if (inFence || !/^(import|export)\s/.test(l.text)) continue;
        let j = i;
        while (j < doc.lines && doc.line(j + 1).text.trim() !== '') j++;
        esm.push({ from: l.from, to: doc.line(j).to });
        i = j;
    }
    return { frontmatter, esm };
}

export const metaField = StateField.define<Meta>({
    create: (state) => findMeta(state.doc),
    update: (value, tr) => (tr.docChanged ? findMeta(tr.state.doc) : value),
});

export function inMeta(meta: Meta, pos: number): boolean {
    const hit = (s: Span) => pos >= s.from && pos <= s.to;
    return (meta.frontmatter !== null && hit(meta.frontmatter)) || meta.esm.some(hit);
}
