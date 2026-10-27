import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { analyseFile, cleanComment } from '../../src/server/registry.ts';

const brief = (a: Awaited<ReturnType<typeof analyseFile>>) =>
    a.props?.map((p) => ({ name: p.name, required: p.required, kind: p.kind, options: p.options, default: p.default }));

describe('analyseFile', () => {
    it('reads an .astro Props interface, its JSDoc and the destructuring defaults', async () => {
        const src = `---
import { AUTHOR } from '../consts';

/**
 * Note — a card in the margin.
 *
 *   <Note kind='reply'>Fair.</Note>
 */
interface Props {
    kind?: 'objection' | 'reply' | 'aside';
    /** Who said it. */
    who: string;
    count?: number;
    open?: boolean;
    src?: ImageMetadata;
}

const { kind = 'aside', who } = Astro.props;
---

<aside><slot /></aside>
`;
        const a = await analyseFile(ts, '/x/Note.astro', src, 'default');
        expect(a.doc).toBe("Note — a card in the margin.\n\n  <Note kind='reply'>Fair.</Note>");
        expect(a.children).toBe(true);
        expect(brief(a)).toEqual([
            {
                name: 'kind',
                required: false,
                kind: 'enum',
                options: ['objection', 'reply', 'aside'],
                default: "'aside'",
            },
            { name: 'who', required: true, kind: 'string', options: undefined, default: undefined },
            { name: 'count', required: false, kind: 'number', options: undefined, default: undefined },
            { name: 'open', required: false, kind: 'boolean', options: undefined, default: undefined },
            { name: 'src', required: false, kind: 'expression', options: undefined, default: undefined },
        ]);
        expect(a.props![1].doc).toBe('Who said it.');
    });

    it('gives a component without Props no props, and one without a slot no children', async () => {
        const a = await analyseFile(
            ts,
            '/x/Pull.astro',
            '---\n/** Pull — a pull quote. */\n---\n<p><slot/></p>',
            'default'
        );
        expect(a).toMatchObject({ doc: 'Pull — a pull quote.', props: [], children: true });
        const b = await analyseFile(ts, '/x/Rule.astro', '<hr />', 'default');
        expect(b).toMatchObject({ props: [], children: false });
    });

    it('reads a React component’s first parameter type and defaults', async () => {
        const src = `import { useMemo } from 'react';
/**
 * HexDump — a hex inspector.
 */
export interface HexDumpProps {
    /** Bytes as a hex string. */
    data: string | number[];
    bytesPerRow?: number;
}
export function HexDump({ data, bytesPerRow = 16 }: HexDumpProps) {
    return <pre>{data}</pre>;
}
export default function Counter() { return <b/>; }
`;
        const a = await analyseFile(ts, '/x/HexDump.tsx', src, 'HexDump');
        expect(a.doc).toBe('HexDump — a hex inspector.');
        expect(a.children).toBe(false);
        expect(brief(a)).toEqual([
            { name: 'data', required: true, kind: 'string', options: undefined, default: undefined },
            { name: 'bytesPerRow', required: false, kind: 'number', options: undefined, default: '16' },
        ]);
        const c = await analyseFile(ts, '/x/HexDump.tsx', src, 'default');
        expect(c).toMatchObject({ props: [], children: false });
    });

    it('sees a children prop as children', async () => {
        const src =
            'type P = { title: string; children: React.ReactNode };\nexport default ({ title, children }: P) => <div>{children}</div>;';
        const a = await analyseFile(ts, '/x/Box.tsx', src, 'default');
        expect(a.children).toBe(true);
        expect(a.props!.map((p) => p.name)).toEqual(['title']);
    });
});

describe('cleanComment', () => {
    it('strips the markers and keeps example indentation', () => {
        expect(cleanComment('/**\n * One.\n *\n *   <X/>\n */')).toBe('One.\n\n  <X/>');
    });
});
