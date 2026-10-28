# astro-mdx-editor

A live-preview editor for MDX content in an Astro site. It runs inside the site's own dev server, styles
the page with the site's real CSS, and saves the `.mdx` file exactly as you typed it: no model and no
re-serialising, so opening and saving a file changes no bytes.

- **Obsidian-style live preview.** Markdown markers hide when your cursor is elsewhere. Block markers
  (`##`, `>`, list numbers) hang in the margin, so the text never jumps.
- **Your theme, live.** The editor sits inside your site's own layout and `Prose` wrapper (a small
  `Shell.astro` you own).
- **Real components.** Components render through your actual MDX pipeline. Put the cursor inside one to
  edit its children; click its chip (or Cmd-Alt-,) for a props form built from the component's `Props`.
- **Frontmatter panel.** A form built from your content collection's schema, with each field's comment
  as help. Fields your layout marks with `data-mdx-field` (a title, a dek) are edited right in the page.
- **Slash menu.** `/` at the start of a line inserts a component, with its required props, or a block.
- **Images.** Paste or drop an image: it's saved into your site and inserted the way your site writes images.
- **Writing workflow.** New entries from `/__edit`, a word count, an outline (Cmd-Shift-O), focus mode
  (Cmd-Alt-.), a scratchpad per entry (Cmd-J), the entry's changes since the last commit with a Commit
  button (Cmd-Shift-G), the published page beside the editor (Cmd-\\), and quick open (Cmd-O).
- **A full keyboard suite.** Cmd-P shows every command. Cmd-Shift-/ shows the cheat sheet.
- **Dev only.** Nothing from the editor ends up in `astro build`.

## Quick start

Needs Astro 7 and Node 22.18 or later. Setup has two steps: add the integration, then add a Shell.

### 1. Add the integration

In your site, or in a new one from Astro's blog starter:

```sh
# npm
npm create astro@latest my-blog -- --template blog   # new site only
cd my-blog
npx astro add astro-mdx-editor
```

```sh
# pnpm
pnpm create astro@latest my-blog --template blog     # new site only
cd my-blog
pnpx astro add astro-mdx-editor
```

`astro add` installs the package and adds `mdxEditor()` to `astro.config.mjs`. Components and HTML in
entries render through `@astrojs/mdx`. The blog starter includes it; other sites can add it with
`npx astro add mdx` (or `pnpx astro add mdx`), and the dev server says so when it's missing.

### 2. Add a Shell

> [!IMPORTANT]
> **Don't skip this step.** Without a Shell, entries open on a plain page with none of your site's
> CSS. The point of the editor is writing in your real layout, fonts, widths and colours, and that takes a
> Shell.

A Shell is a small component that renders `<slot />` inside your post layout. The editor passes it the
entry's `collection` and `id`. For the blog starter:

```astro
---
// src/mdx-editor/Shell.astro
import { getEntry } from 'astro:content';
import BlogPost from '../layouts/BlogPost.astro';
const { collection, id } = Astro.props;
const entry = await getEntry(collection, id);
---

<BlogPost {...entry.data}><slot /></BlogPost>
```

Then pass it to the `mdxEditor()` call that `astro add` wrote:

```js
// astro.config.mjs
import mdx from '@astrojs/mdx';
import { defineConfig } from 'astro/config';
import mdxEditor from 'astro-mdx-editor';

export default defineConfig({
    integrations: [
        mdx(),
        mdxEditor({
            shell: './src/mdx-editor/Shell.astro',
            // pageUrl links each entry to its live page, shown beside the editor with Cmd-\.
            collections: { blog: { pageUrl: (id) => `/blog/${id}/` } },
        }),
    ],
});
```

### 3. Write

Run `npm run dev` (or `pnpm dev`) and open [localhost:4321/\_\_edit](http://localhost:4321/__edit). Without
a `collections` option, the editor offers every folder in `src/content/` that holds `.md` or `.mdx` files,
as a collection of the same name. In `astro build` the editor does nothing, so the built site is the same
with or without it.

## Setup notes

Options with a mistake (a typo, a missing file) turn the editor off with a message naming the option;
the rest of the dev server keeps running.

Sites whose entries import their components (rather than using `globals`) need nothing extra: the editor
page imports every component the collection's entries import, so their CSS loads. Framework components
(React and others) render through the site's own framework integration, as static HTML.

To edit frontmatter fields in the page itself, mark the elements that show them when the layout is
rendered for the editor, e.g. `<h1 data-mdx-field={editing ? 'title' : undefined}>{title}</h1>`.

## Options

| Option                 | Meaning                                                                                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell`                | Path to an `.astro` component that renders `<slot/>` inside your layout and `Prose`. Gets `collection` and `id` props. Default: a plain page.                                                                                                                  |
| `globals`              | Path to a module exporting the components every entry can use without an import. Also imported on the editor page so their CSS loads.                                                                                                                          |
| `collections`          | `{ [name]: { dir?, pageUrl?, newEntry?, images? } }`. Default: each folder in `src/content/` with `.md` or `.mdx` files. `dir` defaults to `src/content/<name>`. `pageUrl(id)` is the live page; `newEntry(title)` the frontmatter of a new entry (see below). |
| `typography`           | `{ quotes, dashes, ellipsis }`: smart typography while typing (all on by default).                                                                                                                                                                             |
| `keymap`               | `{ [commandId]: key }` overrides, for example `{ 'format.bold': 'Mod-Shift-b' }`.                                                                                                                                                                              |
| `callouts`             | Callout types (`> [!type]`) to offer, aliases included. Default: satteri-callouts' Obsidian set. Their look is measured from your site.                                                                                                                        |
| `emoji`                | `{ shortcodes, locale }` as passed to satteri-emoji, so `:shortcode:` previews and completes the same way; `false` turns it off.                                                                                                                               |
| `callouts` (extending) | `import { DEFAULT_CALLOUT_TYPES } from 'astro-mdx-editor'`, then `[...DEFAULT_CALLOUT_TYPES, 'console']`.                                                                                                                                                      |
| `images`               | `{ dir, snippet }` for pasted and dropped images, or `false`. Also settable per collection. See below.                                                                                                                                                         |

### Images

Pasting or dropping an image saves it into `dir` (relative to the project; `{collection}` and `{id}` are
filled in, default `src/assets/{collection}/{id}`) and inserts what `snippet` returns. `snippet` gets the
path relative to the entry, alt text from the file name, the file name, and an import identifier the
entry doesn't use yet. It returns the markup, or the markup plus import lines (lines the entry already
has are skipped):

```js
// A Markdown image (the default)
images: { dir: 'src/assets/essays/{id}' },

// An imported image in a component
images: {
    dir: 'src/assets/projects/{id}',
    snippet: ({ path, alt, ident }) => ({
        imports: [`import Figure from '../../components/Figure.astro';`, `import ${ident} from '${path}';`],
        markup: `<Figure src={${ident}} alt="${alt}" />`,
    }),
},
```

### New entries and commits

The `/__edit` index has a form per collection. A new entry's file name is the title as a slug, and its
frontmatter is `newEntry(title)` (default `{ title }`), with dates written as `YYYY-MM-DD` and any field
the schema requires filled with an empty value:

```js
collections: { essays: { newEntry: (title) => ({ title, description: '', pubDate: new Date(), draft: true }) } },
```

Commit (Cmd-Shift-G) saves, then commits only the open entry and the images it references that git
doesn't have yet, with your message. Whatever else is staged stays staged. Nothing is pushed.

## Develop

```sh
npm install
npm test            # unit tests
npm run typecheck
npm run roundtrip -- ../thoughts ../engineering-notebook   # byte-for-byte round-trip gate
npm run build       # dist/, what npm publishes (also runs on npm pack)
```

To work on the editor against a real site, check this repo out next to it (e.g. `~/Projects/astro-mdx-editor`
beside `~/Projects/thoughts`) and load the source from the site's config only when it's there. Changes then
show up without a build or publish, and CI and other machines build the site without the editor:

```js
// astro.config.mjs
import { existsSync } from 'node:fs';

const editorEntry = new URL('../astro-mdx-editor/src/index.ts', import.meta.url);
const mdxEditor = existsSync(editorEntry) ? (await import(editorEntry.href)).default : null;

export default defineConfig({
    integrations: [mdx(), mdxEditor?.({ shell: './src/mdx-editor/Shell.astro', collections: { essays: {} } })].filter(
        Boolean
    ),
});
```

### Releasing

The sibling checkout runs the source, so check the package itself before publishing:

1. `npm pack`, then copy a site (skipping its `dist/`, `.git/` and `.astro/dev.json`) and
   `npm install --no-save <path to the .tgz>` in the copy.
2. Import `astro-mdx-editor` in the copy's config, run `astro dev`, open an entry with `?selftest`, and
   check that the frontmatter panel, slash menu and `:emoji:` completion load (they use lazy server imports).
3. `astro build` the copy.
4. Move "Unreleased" in CHANGELOG.md under the new version, `npm version <patch|minor|major>`, then
   `npm publish`.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it fits together, [docs/DECISIONS.md](docs/DECISIONS.md) for
why it's built this way, and [CHANGELOG.md](CHANGELOG.md) for what's landed.
