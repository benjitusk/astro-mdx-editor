# Architecture

```
browser /__edit/essays/judging
   │
   ▼
src/pages/edit.astro ──► site Shell.astro (layout + Prose) ──► #mdx-editor ──► src/client/main.ts
   ▲                                                                              │
   │ virtual:mdx-editor/{shell,globals,server}                                    │ fetch /__edit/api/* (token)
   │                                                                              ▼
src/integration.ts ── astro:config:setup ── injectRoute, Vite plugin (virtual modules, dedupe, fs.allow)
                   └─ astro:server:setup ── src/server/api.ts (file API, render API), watcher → HMR event
```

## Server (Node, inside `astro dev`)

| File                         | Role                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/integration.ts`         | The Astro integration. It does nothing unless `command === 'dev'`. It injects `/__edit` and `/__edit/[collection]/[...id]`, adds the Vite plugin, and mounts the API.                                                                                                                                           |
| `src/server/vite-plugin.ts`  | Virtual modules: `shell` (the site's Shell), `globals` (the site's globally available components), `styles` (every component the collections' entries import, for their CSS), `server` (the token and entry reader for pages). It also pins `astro` and `@astrojs/mdx` to the site's copies (`resolve.dedupe`). |
| `src/server/entries.ts`      | Maps `collection/id` to a file under the collection's `dir`, refusing anything outside it. Lists entries.                                                                                                                                                                                                       |
| `src/server/api.ts`          | `/__edit/api/*` middleware. Every request needs the per-session token header and a same-origin `Origin`. `PUT /file` is refused with 409 when the file on disk no longer matches the base hash the client saw.                                                                                                  |
| `src/server/render.ts`       | `POST /render`: writes a block's MDX (with the entry's imports, made absolute) to a snippet file named by its hash, loads it through the SSR runner and renders it. Results are cached by snippet; the cache clears when any non-entry source file changes.                                                     |
| `src/server/render-entry.ts` | Runs inside the SSR runner: the Container API plus the MDX renderer and the site's framework renderers (`@astrojs/react/server.js`…, resolved from the site), rendering with the site's globals as `components`.                                                                                                |
| `src/server/reload.ts`       | Routes full-page reloads per tab: editors get a custom event saying `content` or `code` (see Saving).                                                                                                                                                                                                           |
| `src/server/hash.ts`         | SHA-1 of the file text, shared by the API and the page.                                                                                                                                                                                                                                                         |
| `src/server/emoji.ts`        | `GET /emoji`: the shortcode table from the site's own satteri-emoji registry, merged in the site's catalog order.                                                                                                                                                                                               |
| `src/server/schema.ts`       | `GET /schema`: the collection's zod schema as JSON Schema (converted in `schema-entry.ts`, inside the SSR runner) plus the JSDoc above each field in the content config, by dotted path.                                                                                                                        |
| `src/server/images.ts`       | `POST /upload`: saves a pasted or dropped image into the configured folder (clean name, numbered on a clash, reused when identical), then calls the site's `snippet` with the relative path, alt text and an unused import name.                                                                                |
| `src/server/newentry.ts`     | `POST /new`: slug from the title, frontmatter from the collection's `newEntry` plus empty values for required fields; answers once Astro's content store has synced, so the editor page finds the entry.                                                                                                        |
| `src/server/git.ts`          | `GET /diff` (the entry at HEAD) and `POST /commit` (`git add` then `git commit --only` with the entry and the images it references that have changes). Paths go through `realpath`, as git reports its root's real path.                                                                                        |
| `src/server/pages.ts`        | Which entry a site page shows, for the dev toolbar's "Edit this page": the entry whose `pageUrl` is the page, else one whose id ends the path. Answered over the HMR socket to the asking tab only.                                                                                                             |
| `src/server/registry.ts`     | `GET /registry`: the components an entry can use (globals, its imports, other entries' imports, resolved with Vite's resolver), each with props parsed from `Props` by the TypeScript parser, docs, and its usual form and quote style in the collection.                                                       |

**Middleware has to be mounted in `astro:server:setup`.** A Vite plugin's `configureServer` added through
`updateConfig` runs after Astro's page handler and never sees the request (found in the phase 0 spike).

**Component rendering (phase 2).** A block's MDX is written once per hash to
`node_modules/.mdx-editor/snippets/<hash>.mdx` and imported with
`server.environments.ssr.runner.import()`, so it goes through the site's real MDX pipeline. It's rendered
with `experimental_AstroContainer`, with `@astrojs/mdx/server.js` registered as the `astro:jsx` renderer.

**Loading.** Published sites install the package from npm, which ships `dist/`: `tsc` output plus the
`.astro` pages and CSS, built by `scripts/build.ts`. Sites developing the editor import `src/index.ts`
from a sibling checkout (see README), so their lockfiles and CI never reference this repo. Modules loaded
by path rather than imported (`render-entry`, `schema-entry`, `entries`) are named with `siblingModule()`
(`src/server/modules.ts`), which keeps the running file's extension. The client's dependencies, nested in
this repo's `node_modules` or hoisted into the site's, are excluded from the site's dependency optimizer,
and Vite serves them as plain ES modules, one copy each.

## Client (browser, bundled by the site's Vite)

| File                        | Role                                                                                                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/client/main.ts`        | Reads the page's data attributes and the JSON doc, then builds the editor.                                                                                                                                                                                     |
| `src/client/editor.ts`      | Assembles the CodeMirror state and view: Markdown language, live preview, keymap, typography, paste, save.                                                                                                                                                     |
| `src/client/mdxblocks.ts`   | A Lezer Markdown extension for component tags as MDX reads them: a lone opening tag starts an `MdxBlock` composite whose children are parsed relative to their own indent; lone self-closing, closing and multi-line tags are `HTMLBlock`s of their own lines. |
| `src/client/tables.ts`      | GFM tables drawn as `<table>` off-cursor (cells' inline Markdown rendered client-side), with clicks mapped to the cell's source.                                                                                                                               |
| `src/client/meta.ts`        | Finds the frontmatter and the top-of-file `import`/`export` lines, which Lezer doesn't understand, so other modules leave them alone.                                                                                                                          |
| `src/client/jsx.ts`         | A synchronous scanner for component elements (capitalised tags), classified as `block`, `line`, `void` or `inline`. It tolerates half-typed MDX: an unclosed tag stays raw and its children still count.                                                       |
| `src/client/components.ts`  | Mode A: rendered widgets when the cursor is elsewhere, a frame with a props chip when it's inside, raw MDX on `</>`, Cmd-Enter or a cursor in a tag. Also fetches renders, and handles arrow keys in and out and the Backspace/Delete guard.                   |
| `src/client/raw.ts`         | Which elements show as raw MDX (`</>`), shared by the blocks and the props popover.                                                                                                                                                                            |
| `src/client/registry.ts`    | The registry in a `StateField`, and the file's quote style.                                                                                                                                                                                                    |
| `src/client/props.ts`       | The props popover (a CodeMirror tooltip at the element) and `propChange`, which rewrites one prop's text in an opening tag and nothing else.                                                                                                                   |
| `src/client/slash.ts`       | The `/` menu (an autocomplete source) and component insertion: snippet, blank lines, import line, then the popover for required props.                                                                                                                         |
| `src/client/frontmatter.ts` | `fieldEdit`: sets, adds or removes one frontmatter field by rewriting that field's text only (node ranges from the `yaml` parser).                                                                                                                             |
| `src/client/fmpanel.ts`     | The frontmatter bar in the text, the side panel built from the schema, and the page's `data-mdx-field` elements, kept in sync both ways.                                                                                                                       |
| `src/client/textmap.ts`     | Maps a click in rendered HTML back to the source: normalise both sides, then look up the text around the click.                                                                                                                                                |
| `src/client/livepreview.ts` | A `StateField` of decorations built from the Lezer Markdown tree (see "Live preview" below).                                                                                                                                                                   |
| `src/client/commands.ts`    | Every command in one table: id, label, default key, `run`. The keymap, palette and cheat sheet are all built from it.                                                                                                                                          |
| `src/client/typography.ts`  | Smart quotes, dashes and ellipsis, each its own undo step and skipped in code, JSX and frontmatter.                                                                                                                                                            |
| `src/client/images.ts`      | Image paste and drop: uploads, then inserts the snippet as a block (blank lines around it, missing import lines added, alt text selected), at a position mapped through edits made meanwhile.                                                                  |
| `src/client/writing.ts`     | Word count (prose only), heading outline, focus mode, quick open.                                                                                                                                                                                              |
| `src/client/workflow.ts`    | The side panes, one at a time: scratchpad (`localStorage`), changes and commit (`unifiedMergeView`), live page (an iframe of `pageUrl`). The page gets a right margin while one is open.                                                                       |
| `src/client/paste.ts`       | A URL pasted over a selection makes a link. HTML is converted to Markdown with turndown. Cmd-Shift-V pastes plain text.                                                                                                                                        |
| `src/client/save.ts`        | Autosave, status, conflict banner, external-change reload.                                                                                                                                                                                                     |
| `src/client/palette.ts`     | The command palette and cheat sheet.                                                                                                                                                                                                                           |
| `src/client/picker.ts`      | A filterable list in a `<dialog>`, shared by the palette and the callout type picker.                                                                                                                                                                          |
| `src/client/callouts.ts`    | Callout detection, the icon widget, insert/change type (Cmd-Shift-C, or a click on the icon), and the probe that measures the site's callout styles.                                                                                                           |
| `src/client/emoji.ts`       | `:shortcode:` widgets and completion, from the table `GET /emoji` serves.                                                                                                                                                                                      |
| `src/client/selftest.ts`    | The in-page click-accuracy test (`?selftest`).                                                                                                                                                                                                                 |
| `src/client/toolbar.ts`     | The "Edit this page" app in Astro's dev toolbar, on every page of the site: a dot when the page shows an entry, and a click opens it in the editor.                                                                                                            |
| `src/client/editor.css`     | Editor styles, built on the site's design tokens (`--space-*`, `--accent`…) with fallbacks.                                                                                                                                                                    |

### Live preview

- **Real elements for inline marks.** Emphasis, strong, code, strikethrough, links and heading text are
  mark decorations with `tagName` set (`em`, `strong`, `code`, `s`, `a`, `h2`…), so the site's own CSS
  styles them.
- **Margins are replicated.** Prose's direct-child spacing rules (`.prose > * + *`) can't reach through
  CodeMirror's DOM, so each line type gets the equivalent padding in `editor.css`.
- **Hanging markers.** `##`, `>`, list markers and indentation are positioned in the left margin.
  Revealing or hiding them never moves the text, which keeps clicks accurate.
- **Inline markers** (`**`, `_`, `` ` ``, `[`, `](…)`) are the only reveals that shift text, and only in
  the node the cursor is in.
- **Clicks lean toward the content.** A transaction filter moves a pointer selection that lands at a
  hidden prefix to the content side of it, past back-to-back prefixes (`> ` then `[!type] `).
- **Callouts are cards made of lines.** Each line of the quote is a slice of the card, drawn behind it
  with `::before`: top edge on the first line, bottom on the last. `[!type] ` is an atomic icon widget.
  The card's look is measured: on load the client renders `> [!type]` for every type through
  `POST /render`, puts the HTML in a hidden probe inside Prose, reads `getComputedStyle`, and writes
  `--co-*` variables per type into a stylesheet. It measures again when the colour scheme changes.
- **Emoji are characters.** A known `:shortcode:` is an atomic widget wherever satteri-emoji would
  convert it, cursor or not, so it never expands under the caret.
- **Soft-wrapped paragraphs flow.** Each line break inside a paragraph (outside quotes, components and
  the imports) is an atomic replace widget showing a space, so a hard-wrapped paragraph reads as on the
  page. The click test skips "left of text" on those lines, which start mid-row.
- **Component children parse like MDX.** Lezer's own HTML block runs to the next blank line and its lists
  stop at 4 spaces of indentation; `mdxblocks.ts` makes children a composite block whose base indentation
  is the children's own (as blockquotes and list items move the base).
- **Tables and task boxes** are widgets: a table is a block widget off-cursor and monospace source on it;
  `[x]` is an atomic checkbox.
- **Images show the image.** Off-cursor, `![alt](src)` is replaced by an `<img>` (a relative `src`
  resolved against the entry's folder, served by Vite at `/@fs/…`). With the cursor on it, the source
  shows and the image sits under it on the same line, so a click on an image reveals its source.
- **The selection is a tint over the text** (`.cm-selectionLayer` above the content), because line
  backgrounds (cards, frames) would otherwise paint over it.

### Saving

- The client keeps `baseHash`, the hash of the text it last loaded or saved. `PUT` sends it along.
- On a 409 the client shows a banner: keep mine (overwrite) or load theirs.
- Every save makes Astro send full-page reloads to every tab: one from the content store (`path: '*'`)
  and one from its HMR plugin, because the `.mdx` is also an SSR module. `src/server/reload.ts` wraps
  the HMR channel:
    - Editor tabs announce themselves (`mdx-editor:hello`) and get `mdx-editor:full-reload` with a
      `kind` instead. Every other tab still reloads as before.
    - The `kind` is `content` when every file in the latest change burst is an entry or under `.astro/`,
      and `code` otherwise.
    - The client ignores `content`. On `code` it reloads once there are no unsaved edits, then restores
      the cursor and scroll position (`src/client/reload.ts`).
- The server's file watcher sends `mdx-editor:file-changed` over Vite HMR. The client reloads silently
  if it has no unsaved edits. The reload replaces only the changed span, so the cursor survives.

## Invariants

1. The document text is the file text. Saving writes `doc.toString()` as-is, with the file's line endings
   (`EditorState.lineSeparator`).
2. No API request without the token and a same-origin `Origin`.
3. Nothing in `astro build` output.
