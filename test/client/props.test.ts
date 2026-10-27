import { describe, expect, it } from 'vitest';
import type { Api } from '../../src/client/api.ts';
import { componentExtensions, components } from '../../src/client/components.ts';
import { jsxField } from '../../src/client/jsx.ts';
import { attrText, propChange } from '../../src/client/props.ts';
import { setRegistry } from '../../src/client/registry.ts';
import { componentSnippet, insertComponent } from '../../src/client/slash.ts';
import type { ComponentInfo } from '../../src/types.ts';
import { marked, view } from './helpers.ts';

const api = { render: async () => ({ html: '<p>rendered</p>' }) } as unknown as Api;

/** Set one prop of the first element and return the doc. */
function setProp(src: string, name: string, attr: string | null) {
    const v = view(src);
    const el = v.state.field(jsxField)[0];
    const change = propChange(v.state, el, name, attr);
    if (change) v.dispatch({ changes: change });
    return v.state.doc.toString();
}

describe('propChange', () => {
    it('rewrites only the prop it changes', () => {
        expect(setProp("<Note kind='objection'  who='R'>x</Note>", 'who', "who='Rivka'")).toBe(
            "<Note kind='objection'  who='Rivka'>x</Note>"
        );
    });
    it('adds a prop after the last one, or one per line when the tag is written that way', () => {
        expect(setProp('<Pull>x</Pull>', 'big', 'big')).toBe('<Pull big>x</Pull>');
        expect(setProp("<Note kind='reply'>x</Note>", 'side', "side='left'")).toBe(
            "<Note kind='reply' side='left'>x</Note>"
        );
        expect(setProp('<Figure\n    src={img}\n    alt="A"\n/>', 'caption', 'caption="C"')).toBe(
            '<Figure\n    src={img}\n    alt="A"\n    caption="C"\n/>'
        );
    });
    it('removes a prop with the space or line before it', () => {
        expect(setProp("<Note kind='reply' who='B'>x</Note>", 'kind', null)).toBe("<Note who='B'>x</Note>");
        expect(setProp('<Figure\n    src={img}\n    alt="A"\n/>', 'alt', null)).toBe('<Figure\n    src={img}\n/>');
    });
});

describe('attrText', () => {
    it('writes each kind of prop', () => {
        expect(attrText('who', 'string', 'Rivka', "'")).toBe("who='Rivka'");
        expect(attrText('who', 'string', "Rivka's", "'")).toBe(`who="Rivka's"`);
        expect(attrText('who', 'string', `a "b" c's`, "'")).toBe(`who={"a \\"b\\" c's"}`);
        expect(attrText('n', 'number', '4', '"')).toBe('n={4}');
        expect(attrText('n', 'number', '', '"')).toBe(null);
        expect(attrText('open', 'boolean', true, '"')).toBe('open');
        expect(attrText('open', 'boolean', false, '"')).toBe(null);
        expect(attrText('src', 'expression', 'img', '"')).toBe('src={img}');
    });
});

const define: ComponentInfo = {
    name: 'Define',
    file: 'src/components/Define.astro',
    doc: '',
    props: [
        { name: 'word', required: true, type: 'string', kind: 'string' },
        { name: 'pos', required: false, type: 'string', kind: 'string' },
    ],
    children: true,
    form: 'block',
    import: null,
};

describe('componentSnippet', () => {
    it('writes a block with its required props and the blank lines MDX needs', () => {
        const s = componentSnippet(define, "'", '');
        expect(s.text).toBe("<Define word=''>\n\n\n\n</Define>");
        expect(s.text.slice(0, s.cursor)).toBe("<Define word=''>\n\n");
    });
    it('writes one-line and self-closing forms', () => {
        expect(componentSnippet({ ...define, props: [], form: 'line', name: 'Pull' }, '"', '').text).toBe(
            '<Pull></Pull>'
        );
        const v = componentSnippet({ ...define, form: 'void', name: 'Stance' }, '"', '    ');
        expect(v.text).toBe('<Stance word="" />\n\n    ');
    });
});

describe('inserting a component', () => {
    it('replaces the slash, keeps blank lines around it, and enters its frame', () => {
        const v = view('Intro\n/def|\nAfter', componentExtensions(api));
        v.dispatch({ effects: setRegistry.of({ components: [define], quote: "'" }) });
        const head = v.state.selection.main.head;
        insertComponent(v, define, head - 4, head);
        expect(marked(v)).toBe("Intro\n\n<Define word=''>\n\n|\n\n</Define>\n\nAfter");
        expect(v.state.field(components).entered.map((f) => f.el.name)).toEqual(['Define']);
    });
    it('adds the import line a component needs', () => {
        const v = view("---\ntitle: x\n---\n\nimport A from './a';\n\n/|", componentExtensions(api));
        const callout = { ...define, name: 'Callout', props: [], import: "import Callout from '../C.astro';" };
        const head = v.state.selection.main.head;
        insertComponent(v, callout, head - 1, head);
        expect(v.state.doc.toString()).toBe(
            "---\ntitle: x\n---\n\nimport A from './a';\nimport Callout from '../C.astro';\n\n<Callout>\n\n\n\n</Callout>"
        );
    });
});

describe('frames for empty elements', () => {
    it('frames an empty one-line element with the cursor between its tags', () => {
        const v = view("<Note kind='aside'>|</Note>\n\nAfter", componentExtensions(api));
        expect(v.state.field(components).entered.map((f) => f.el.name)).toEqual(['Note']);
    });
    it('frames a blank line the cursor is on inside a block', () => {
        const v = view('<Quote>\n\nText.\n|\n\n</Quote>\n\nAfter', componentExtensions(api));
        const [f] = v.state.field(components).entered;
        expect(v.state.sliceDoc(f.from, f.to)).toBe('Text.\n');
    });
});
