import { StateEffect, StateField } from '@codemirror/state';
import { allElements, jsxField } from './jsx.ts';

/** Show the element starting at this position as raw MDX (or stop). */
export const toggleRaw = StateEffect.define<number>();

/** Elements shown as raw MDX (by start position). An element leaves raw mode when the cursor leaves it. */
export const rawOpen = StateField.define<number[]>({
    create: () => [],
    update(value, tr) {
        let out = tr.docChanged ? value.map((p) => tr.changes.mapPos(p)) : value;
        for (const e of tr.effects) {
            if (!e.is(toggleRaw)) continue;
            out = out.includes(e.value) ? out.filter((p) => p !== e.value) : [...out, e.value];
        }
        if (out.length && (tr.selection || tr.docChanged)) {
            const els = [...allElements(tr.state.field(jsxField))];
            const head = tr.state.selection.main.head;
            out = out.filter((p) => {
                const el = els.find((e) => e.from === p);
                return el && head >= el.from && head <= el.to;
            });
        }
        return out;
    },
});
