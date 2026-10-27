export interface CollectionOptions {
    /** Folder holding the collection's files, relative to the project root. Default: `src/content/<name>`. */
    dir?: string;
    /** The published URL of an entry, for "open page" links and the live-page pane. */
    pageUrl?: (id: string) => string;
}

export interface TypographyOptions {
    /** Straight quotes become “ ” ‘ ’ as you type. */
    quotes?: boolean;
    /** `--` becomes —. */
    dashes?: boolean;
    /** `...` becomes …. */
    ellipsis?: boolean;
}

export interface MdxEditorOptions {
    /** An `.astro` component that renders `<slot/>` inside the site's layout and Prose. */
    shell: string;
    /** A module exporting the components every entry can use without an import. */
    globals?: string;
    collections: Record<string, CollectionOptions>;
    typography?: TypographyOptions;
    /** Key overrides by command id, e.g. `{ 'format.bold': 'Mod-Shift-b' }`. */
    keymap?: Record<string, string>;
}

/** A collection with its folder resolved to an absolute path. */
export interface ResolvedCollection {
    name: string;
    dir: string;
}

/** What the client needs to boot, serialised into the editor page. */
export interface ClientConfig {
    collection: string;
    id: string;
    token: string;
    hash: string;
    pageUrl: string | null;
    typography: Required<TypographyOptions>;
    keymap: Record<string, string>;
}
