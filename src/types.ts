export interface CollectionOptions {
    /** Folder holding the collection's files, relative to the project root. Default: `src/content/<name>`. */
    dir?: string;
    /** The published URL of an entry, for "open page" links and the live-page pane. */
    pageUrl?: (id: string) => string;
    /** Overrides the top-level `images` for this collection; `false` turns paste and drop off here. */
    images?: ImageOptions | false;
}

/** An image the editor saved, as passed to `images.snippet`. */
export interface ImageInfo {
    /** The file's path relative to the entry, e.g. `../../assets/essays/judging/sketch.png`. */
    path: string;
    /** Alt text: from the file name, or empty for a pasted screenshot. */
    alt: string;
    /** The file name, e.g. `sketch.png`. */
    name: string;
    /** A JavaScript identifier for importing it, unused in the entry's imports (`sketch`, `howManyTimes2`). */
    ident: string;
    collection: string;
    id: string;
}

export interface ImageOptions {
    /** Folder the images are saved in, relative to the project root. `{collection}` and `{id}` are filled in. Default: `src/assets/{collection}/{id}`. */
    dir?: string;
    /**
     * The MDX inserted for an image: a string, or markup plus import lines it needs (added when the entry
     * doesn't have them yet). Default: `![alt](path)`.
     */
    snippet?: (image: ImageInfo) => string | { markup: string; imports?: string[] };
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
    /** Where pasted and dropped images are saved and what's inserted for them; `false` turns it off. */
    images?: ImageOptions | false;
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
    /** Whether pasted and dropped images are saved (`POST /upload`). */
    images: boolean;
    /** The URL the entry's folder is served at in dev, for showing its relative image paths. */
    fileBase: string;
}

/** `POST /upload`: what to insert for a saved image. */
export interface UploadResult {
    /** The saved file, relative to the project root. */
    file: string;
    markup: string;
    imports: string[];
    /** The alt text's range in `markup`, to select it after inserting. */
    alt: [number, number] | null;
}

/** One prop of a component, read from its `Props` type. */
export interface PropInfo {
    name: string;
    required: boolean;
    /** The type as written, e.g. `'note' | 'warning'`. */
    type: string;
    /** How the props popover edits it; `expression` props are written as `{…}`. */
    kind: 'string' | 'number' | 'boolean' | 'enum' | 'expression';
    /** The string literals of an `enum` prop. */
    options?: string[];
    /** The default from the component's destructuring (`kind = 'aside'`), as written. */
    default?: string;
    /** The prop's JSDoc. */
    doc?: string;
}

/** A component an entry can use, from `GET /registry`. */
export interface ComponentInfo {
    /** The tag name. */
    name: string;
    /** The component's file, relative to the project root. */
    file: string;
    /** The component's header comment, without the comment markers. */
    doc: string;
    /** Null when the props couldn't be read (an unsupported file type, no `Props`). */
    props: PropInfo[] | null;
    /** Whether it renders children (a `<slot/>`, or a `children` prop). */
    children: boolean;
    /** How it's usually written in the collection, for inserting it. */
    form: 'block' | 'line' | 'void';
    /** The import line to add before using it, or null when it's global or already imported. */
    import: string | null;
}

export interface Registry {
    components: ComponentInfo[];
    /** The quote the collection writes string props with. */
    quote: '"' | "'";
}

/** The JSON Schema subset the frontmatter panel reads (as produced by zod's `toJSONSchema`). */
export interface FieldSchema {
    type?: string | string[];
    format?: string;
    enum?: unknown[];
    const?: unknown;
    minimum?: number;
    maximum?: number;
    description?: string;
    default?: unknown;
    properties?: Record<string, FieldSchema>;
    required?: string[];
    additionalProperties?: boolean | FieldSchema;
    items?: FieldSchema;
    anyOf?: FieldSchema[];
}

/** `GET /schema`: a collection's frontmatter schema, and the JSDoc above each field by dotted path. */
export interface CollectionSchema {
    schema: FieldSchema;
    docs: Record<string, string>;
}
