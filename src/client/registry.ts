import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { ComponentInfo, Registry } from '../types.ts';
import type { Api } from './api.ts';
import { allElements, jsxField } from './jsx.ts';

/** The components this entry can use, from `GET /registry` (see src/server/registry.ts). */

export const setRegistry = StateEffect.define<Registry>();
/** A component's import line was added to the file: it's now available as it is. */
export const markImported = StateEffect.define<string>();

export const registryField = StateField.define<Registry | null>({
    create: () => null,
    update(value, tr) {
        for (const e of tr.effects) {
            if (e.is(setRegistry)) value = e.value;
            else if (e.is(markImported) && value)
                value = {
                    ...value,
                    components: value.components.map((c) => (c.name === e.value ? { ...c, import: null } : c)),
                };
        }
        return value;
    },
});

export function componentInfo(state: EditorState, name: string): ComponentInfo | null {
    return state.field(registryField, false)?.components.find((c) => c.name === name) ?? null;
}

/** The quote this file writes string props with, else the collection's. */
export function quoteStyle(state: EditorState): '"' | "'" {
    const counts = { '"': 0, "'": 0 };
    for (const el of allElements(state.field(jsxField)))
        for (const p of el.props) if (p.value !== null) counts[p.raw![0] as '"' | "'"]++;
    if (counts['"'] !== counts["'"]) return counts["'"] > counts['"'] ? "'" : '"';
    return state.field(registryField, false)?.quote ?? '"';
}

export async function loadRegistry(view: EditorView, api: Api) {
    try {
        view.dispatch({ effects: setRegistry.of(await api.registry()) });
    } catch {
        // no slash menu components or prop docs; editing still works
    }
}
