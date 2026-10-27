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

## Use it in a site

Check this repo out next to the site (e.g. `~/Projects/astro-mdx-editor` beside `~/Projects/thoughts`) and
load it from the site's config only when it's there. It isn't an npm dependency, so CI and other machines build the
site without it.

```js
// astro.config.mjs
import { existsSync } from 'node:fs';

const editorEntry = new URL('../astro-mdx-editor/src/index.ts', import.meta.url);
const mdxEditor = existsSync(editorEntry) ? (await import(editorEntry.href)).default : null;

export default defineConfig({
    integrations: [
        mdx(),
        mdxEditor?.({
            shell: './src/mdx-editor/Shell.astro',
            globals: './src/mdx-editor/globals.ts',
            collections: { essays: {} },
        }),
    ].filter(Boolean),
});
```

```astro
---
// src/mdx-editor/Shell.astro: wrap the editor in your page chrome and Prose.
import { getEntry } from 'astro:content';
import Essay from '../layouts/Essay.astro';
const { collection, id } = Astro.props;
const entry = await getEntry(collection, id);
---

<Essay essay={entry} editing><slot /></Essay>
```

Then run `astro dev` and open `/__edit`.

Sites whose entries import their components (rather than using `globals`) need nothing extra: the editor
page imports every component the collection's entries import, so their CSS loads. Framework components
(React and others) render through the site's own framework integration, as static HTML.

To edit frontmatter fields in the page itself, mark the elements that show them when the layout is
rendered for the editor, e.g. `<h1 data-mdx-field={editing ? 'title' : undefined}>{title}</h1>`.

## Options

| Option                 | Meaning                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell`                | Path to an `.astro` component that renders `<slot/>` inside your layout and `Prose`. Gets `collection` and `id` props.                                                                      |
| `globals`              | Path to a module exporting the components every entry can use without an import. Also imported on the editor page so their CSS loads.                                                       |
| `collections`          | `{ [name]: { dir?, pageUrl?, newEntry?, images? } }`. `dir` defaults to `src/content/<name>`. `pageUrl(id)` is the live page; `newEntry(title)` the frontmatter of a new entry (see below). |
| `typography`           | `{ quotes, dashes, ellipsis }`: smart typography while typing (all on by default).                                                                                                          |
| `keymap`               | `{ [commandId]: key }` overrides, for example `{ 'format.bold': 'Mod-Shift-b' }`.                                                                                                           |
| `callouts`             | Callout types (`> [!type]`) to offer, aliases included. Default: satteri-callouts' Obsidian set. Their look is measured from your site.                                                     |
| `emoji`                | `{ shortcodes, locale }` as passed to satteri-emoji, so `:shortcode:` previews and completes the same way; `false` turns it off.                                                            |
| `callouts` (extending) | `import { DEFAULT_CALLOUT_TYPES } from '…/astro-mdx-editor/src/index.ts'`, then `[...DEFAULT_CALLOUT_TYPES, 'console']`.                                                                    |
| `images`               | `{ dir, snippet }` for pasted and dropped images, or `false`. Also settable per collection. See below.                                                                                      |

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
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it fits together, [docs/DECISIONS.md](docs/DECISIONS.md) for
why it's built this way, and [CHANGELOG.md](CHANGELOG.md) for what's landed.
