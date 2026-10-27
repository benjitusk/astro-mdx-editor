# astro-mdx-editor

A live-preview editor for MDX content in an Astro site. It runs inside the site's own dev server, styles
the page with the site's real CSS, and saves the `.mdx` file exactly as you typed it: no model and no
re-serialising, so opening and saving a file changes no bytes.

- **Obsidian-style live preview.** Markdown markers hide when your cursor is elsewhere. Block markers
  (`##`, `>`, list numbers) hang in the margin, so the text never jumps.
- **Your theme, live.** The editor sits inside your site's own layout and `Prose` wrapper (a small
  `Shell.astro` you own).
- **Real components.** Components render through your actual MDX pipeline (in progress, phase 2).
- **A full keyboard suite.** Cmd-P shows every command. Cmd-Shift-/ shows the cheat sheet.
- **Dev only.** Nothing from the editor ends up in `astro build`.

## Use it in a site

```sh
npm i -D file:../astro-mdx-editor
```

```js
// astro.config.mjs
import mdxEditor from 'astro-mdx-editor';

export default defineConfig({
    integrations: [
        mdx(),
        mdxEditor({
            shell: './src/mdx-editor/Shell.astro',
            globals: './src/mdx-editor/globals.ts',
            collections: { essays: {} },
        }),
    ],
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

## Options

| Option        | Meaning                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `shell`       | Path to an `.astro` component that renders `<slot/>` inside your layout and `Prose`. Gets `collection` and `id` props.                |
| `globals`     | Path to a module exporting the components every entry can use without an import. Also imported on the editor page so their CSS loads. |
| `collections` | `{ [name]: { dir?, pageUrl? } }`. `dir` defaults to `src/content/<name>`.                                                             |
| `typography`  | `{ quotes, dashes, ellipsis }`: smart typography while typing (all on by default).                                                    |
| `keymap`      | `{ [commandId]: key }` overrides, for example `{ 'format.bold': 'Mod-Shift-b' }`.                                                     |

## Develop

```sh
npm install
npm test            # unit tests
npm run typecheck
npm run roundtrip -- ../thoughts ../engineering-notebook   # byte-for-byte round-trip gate
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it fits together, [docs/DECISIONS.md](docs/DECISIONS.md) for
why it's built this way, and [CHANGELOG.md](CHANGELOG.md) for what's landed.
