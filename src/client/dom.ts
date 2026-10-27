type Attrs = Record<string, string | boolean | ((e: Event) => void) | undefined>;

/** A tiny element builder for the editor's own UI (banner, palette, status). */
export function h<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Attrs = {},
    ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === false) continue;
        if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v as EventListener);
        else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
    return el;
}
