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

export interface EmojiOptions {
    /** satteri-emoji's `shortcodes` catalogs, in the same order. Default: `['cldr']`, as satteri-emoji. */
    shortcodes?: string[];
    /** Label language, as satteri-emoji's `locale`. Default: `en`. */
    locale?: string;
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
    /**
     * Callout types (`> [!type]`) the editor offers, including aliases. Default: satteri-callouts'
     * Obsidian set. Each is rendered once by the site to get its look; types the site doesn't render
     * as callouts stay plain quotes.
     */
    callouts?: string[];
    /** Match the site's satteri-emoji setup, so `:shortcode:` previews and completes; `false` turns it off. */
    emoji?: EmojiOptions | false;
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
    callouts: string[];
    /** Whether `GET /emoji` serves a shortcode table. */
    emoji: boolean;
}
