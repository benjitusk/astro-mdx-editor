declare module 'virtual:mdx-editor/shell' {
    const Shell: (props: { collection: string; id: string }) => unknown;
    export default Shell;
}

declare module 'virtual:mdx-editor/globals' {
    const globals: Record<string, unknown>;
    export = globals;
}

declare module 'virtual:mdx-editor/server' {
    import type { ClientConfig } from './types.ts';
    export const token: string;
    export const typography: ClientConfig['typography'];
    export const keymap: Record<string, string>;
    export const callouts: string[];
    export const emoji: boolean;
    export function loadEntry(
        collection: string,
        id: string
    ): Promise<{ collection: string; id: string; path: string; text: string; hash: string } | null>;
    export function entries(): Promise<{ collection: string; id: string; path: string }[]>;
    export function pageUrl(collection: string, id: string): string | null;
}
