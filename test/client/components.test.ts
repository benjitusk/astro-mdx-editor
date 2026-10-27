import { EditorSelection } from '@codemirror/state';
import { runScopeHandlers } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import type { Api } from '../../src/client/api.ts';
import { componentCommands, componentExtensions, components, renderedAt } from '../../src/client/components.ts';
import { view } from './helpers.ts';

const api = { render: async () => ({ html: '<p>rendered</p>' }) } as unknown as Api;
const doc = "Intro\n\n<Define word='judge'>\n\n1. To form an opinion\n2. To give verdict\n\n</Define>\n\nAfter|";
const at = (v: ReturnType<typeof view>, text: string) => v.state.doc.toString().indexOf(text);

describe('mode A components', () => {
    it('renders a block when the cursor is elsewhere', () => {
        const v = view(doc, componentExtensions(api));
        expect(renderedAt(v.state, at(v, 'To form'))).toBe(true);
        expect(v.state.field(components).entered).toEqual([]);
    });
    it('frames a block when the cursor is in its children', () => {
        const v = view(doc, componentExtensions(api));
        v.dispatch({ selection: { anchor: at(v, 'To give') } });
        expect(renderedAt(v.state, at(v, 'To form'))).toBe(false);
        expect(v.state.field(components).entered.map((e) => e.el.name)).toEqual(['Define']);
    });
    it('shows the tag raw when the cursor is in it', () => {
        const v = view(doc, componentExtensions(api));
        v.dispatch({ selection: { anchor: at(v, 'judge') } });
        expect(v.state.field(components).entered).toEqual([]);
        expect(renderedAt(v.state, at(v, 'judge'))).toBe(false);
    });
    it('toggles raw source and drops it when the cursor leaves', () => {
        const v = view(doc, componentExtensions(api));
        v.dispatch({ selection: { anchor: at(v, 'To give') } });
        componentCommands.toggleRaw(v);
        expect(v.state.field(components).entered).toEqual([]);
        v.dispatch({ selection: { anchor: v.state.doc.length } });
        v.dispatch({ selection: { anchor: at(v, 'To give') } });
        expect(v.state.field(components).entered.map((e) => e.el.name)).toEqual(['Define']);
    });
    it("won't let Backspace merge the children into the opening tag", () => {
        const v = view(doc, componentExtensions(api));
        v.dispatch({ selection: EditorSelection.cursor(at(v, '1. To form')) });
        const before = v.state.doc.toString();
        runScopeHandlers(v, new KeyboardEvent('keydown', { key: 'Backspace' }), 'editor');
        expect(v.state.doc.toString()).toBe(before);
    });
    it('leaves a frame with Escape', () => {
        const v = view(doc, componentExtensions(api));
        v.dispatch({ selection: { anchor: at(v, 'To give') } });
        componentCommands.leave(v);
        // The line right after the closing tag.
        expect(v.state.selection.main.head).toBe(at(v, '</Define>') + '</Define>\n'.length);
    });
    it('fetches renders for the blocks it shows', async () => {
        let asked = 0;
        const counting = { render: async () => (asked++, { html: '<p>x</p>' }) } as unknown as Api;
        view(doc, componentExtensions(counting));
        await new Promise((r) => setTimeout(r, 50));
        expect(asked).toBe(1);
    });
});
