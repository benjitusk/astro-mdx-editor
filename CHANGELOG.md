# Changelog

## Unreleased

### Added

- The live page (Cmd-\\) scrolls with the editor, and the editor with it when you scroll the page. Blocks
  are lined up by their text, so headings and paragraphs stay level on both sides.

### Changed

- In the editor, the dev toolbar's pencil goes the other way: it becomes an eye, "View this page", and a
  click opens the entry's published page (from `pageUrl`).

## 0.3.0 (2026-10-29)

### Added

- "Edit this page" in Astro's dev toolbar: on a page that shows an entry, a click opens it in the editor.
  The page is matched by `pageUrl`, or by a path that ends in the entry's id.

## 0.2.2 (2026-10-28)

### Changed

- README and changelog examples describe sites in general, using the blog starter's `blog` collection,
  rather than the sites the editor was first built for.

## 0.2.1 (2026-10-28)

### Changed

- README: the quick start follows `astro add` for npm and pnpm, and adding a Shell is now one of its
  steps.

## 0.2.0 (2026-10-28)

### Added

- Zero-config setup: `shell` and `collections` are optional, so `npx astro add astro-mdx-editor` works in
  Astro's blog starter. Without `collections`, every folder in `src/content/` with Markdown or MDX is
  editable; without `shell`, entries open on a plain page.
- Options are checked at startup: a mistake turns the editor off with a message naming the option, and
  the site's dev server keeps running. A missing `@astrojs/mdx` integration is reported at startup and
  on each block that can't render.

## 0.1.0 (2026-10-28)

### Added

- Repository setup: package, TypeScript and Prettier config, README, ARCHITECTURE, DECISIONS.
- Dev-only Astro integration: `/__edit` index and `/__edit/<collection>/<id>` editor pages, rendered
  inside the site's Shell. Virtual modules for the Shell, globals and server helpers.
- File API (`/__edit/api/file`, `/entries`): token and same-origin checks, path confinement, and 409
  on a stale base hash.
- Autosave with status, a conflict banner, and reloading from disk on external changes (minimal
  change, so the cursor survives).
- Per-tab routing of full-page reloads, so saves don't reload the editor.
- Live preview: inline marks rendered as real elements, block markers hidden and hanging in the margin,
  Prose spacing per line type, and clicks that resolve to a hidden prefix lean to the text.
- Keyboard suite from one command table: inline formats, links, headings (Cmd-Alt-1…3), lists, quote,
  list indent, move/duplicate/select line, MDX comments, add next occurrence, find/replace, save.
  Also a command palette (Cmd-P), a cheat sheet (Cmd-Shift-/) and per-site key overrides.
- Smart typography (quotes, em dash, ellipsis) outside code, JSX and frontmatter, each its own undo step.
  Typing `*`, `_` or `` ` `` wraps a selection.
- Smart paste: a URL over a selection makes a link, rich HTML becomes Markdown, Cmd-Shift-V pastes plain.
- Gates: `npm run roundtrip` (byte-for-byte over a site's entries) and `?selftest` (click accuracy in the
  real page).
- Unit tests (vitest + jsdom) for formatting, typography, live preview, meta detection and entries.
- Components, mode A:
    - with the cursor elsewhere, an element shows its real render from the site's MDX pipeline
      (Container API);
    - with the cursor in a block's children, it shows a frame with a props chip and live-preview
      children, indented children shown dedented, and nested components framed or rendered by the
      same rules;
    - one-line elements (`<Pull>…</Pull>`) edit inline with a chip;
    - `</>` / Cmd-Enter and a cursor in a tag show raw MDX; Escape leaves a component.
- Clicking a word in a render enters the component with the caret right before that word in the
  source.
- Arrow keys step into and out of components. Backspace/Delete can't merge children into their tags.
- Renders are cached, and a changed block shows its last render, dimmed, until the new one arrives.
  Render errors show on the block.
- The click test covers rendered components (482/482 on _judging_ at desktop width, 483/483 at phone
  width, 17 of them clicks inside renders).
- Callouts (`> [!type] Title`) shown as the site's cards, with the look measured from the site's own
  render of each type (light and dark). The type marker is the type's icon; a click on it, or
  Cmd-Shift-C, picks a type. Cmd-Shift-C also starts a callout on a blank line, or turns the paragraph
  or quote at the cursor into one.
- Emoji: `:shortcode:` shows as the emoji wherever the site's satteri-emoji would convert it, and steps
  and deletes as one character. Typing `:` and two letters completes. `GET /__edit/api/emoji` serves
  the site's shortcode table.
- The selection is drawn as a tint over the text, so it shows on cards and frames.
- `callouts` and `emoji` options.
- Component registry (`GET /__edit/api/registry`): the components an entry can use (globals, its
  imports, and those other entries import), each with its props read from `Props` (TypeScript parser),
  defaults, JSDoc, header comment, and its usual form in the collection.
- Props popover: a form for an element's opening tag, from a click on the chip, a click on a render's
  own text (a headword, an attribution: that prop is focused), or Cmd-Alt-,. Each edit rewrites only
  that prop's text; strings keep the file's quote style; expressions stay expressions. Self-closing
  elements open it on click instead of showing raw MDX.
- Slash menu: `/` at the start of a line lists components (docs beside them) and Markdown blocks. A
  component goes in with its required props, blank lines and any import line it needs, and the cursor
  in its frame; required props open the popover. Also "Insert component…" in the palette.
- Empty elements (`<Pull></Pull>`, a block with only blank lines) get a frame to type into, and a blank
  line between a block's tags joins the frame when the cursor is on it (Enter after the last paragraph
  no longer drops to raw MDX).
- Renders send the editor's current imports, so a newly imported component renders before the save.
- Frontmatter panel: a side drawer (click the frontmatter bar, or Cmd-Alt-M) with a form built from
  the collection's zod schema (`GET /__edit/api/schema`): date pickers, selects for enums, number
  inputs with a slider for bounded numbers, checkboxes, comma lists, nested objects, YAML for anything
  else, each field's JSDoc from the content config, required and range messages, and × to remove an
  optional field. Keys outside the schema are listed as YAML.
- Page fields: elements marked `data-mdx-field` (a post's title or dek, say) edit their frontmatter field
  in place; Enter moves to the next field, then the body; Cmd-Z undoes in the editor.
- The frontmatter shows as a one-line summary bar; `</>` or a search match inside it shows the YAML,
  and the cursor can't land in front of it.
- Frontmatter edits rewrite only the field's own text (`src/client/frontmatter.ts`), keeping
  comments, key order, quoting and long lines elsewhere.
- The click test skips the collapsed frontmatter and waits for renders that are still arriving.
- Image paste and drop: image files are saved into the site's images folder (`POST /__edit/api/upload`)
  under a clean name (a screenshot gets `image-<date>-<time>`; the same image twice reuses the file) and
  the site's `images.snippet` decides the MDX, with any import lines it needs. The image goes in as a
  block of its own, with its alt text selected; a drop on a tag goes after the element. One undo removes it.
- `images` option, top level or per collection: `{ dir, snippet }`, or `false`. Default: `![alt](path)` into
  `src/assets/<collection>/<id>`.
- Images show in the live preview: the image alone with the cursor elsewhere, its source with the image
  under it when the cursor is on it. Relative paths load through Vite's `/@fs/`.

- Sites whose entries import their components: a generated `virtual:mdx-editor/styles` module imports
  every component the collections' entries import, so their CSS loads on the editor page.
- Framework components (React, Preact, Vue, Svelte, Solid) render: the site's framework integrations are
  detected and their server renderers registered with the Container API. They render as static HTML.
- `DEFAULT_CALLOUT_TYPES` is exported, to add a site's own callout types (`[...DEFAULT_CALLOUT_TYPES, 'console']`).
- Component tags parse as MDX reads them (`src/client/mdxblocks.ts`): a lone opening tag starts a block
  whose children are parsed relative to their own indentation (4-space-indented Callout children, lists
  included), text right after a tag is Markdown, and self-closing, closing and multi-line tags are blocks
  of their own lines that end a paragraph above them.
- Soft-wrapped paragraphs flow as one paragraph, as on the page: a line break inside a paragraph shows
  as a space and steps and deletes as one.
- Tables are drawn as tables with the cursor elsewhere, and show their source (monospace) with it inside;
  a click on a cell puts the caret in that cell.
- Task list markers (`[ ]`, `[x]`) are checkboxes; a click toggles the source.
- Components and code blocks in list items sit at the item's indent.

- New entries: a form per collection on `/__edit` (`POST /__edit/api/new`) writes the title as a slug with
  the collection's `newEntry(title)` frontmatter (dates as `YYYY-MM-DD`, missing required fields filled)
  and opens it once the content layer has it. The index takes reloads as events, like editor tabs.
- Writing aids: a live word count and reading time (prose only; a selection shows its share), a heading
  outline (Cmd-Shift-O), and focus mode (Cmd-Alt-.) that fades everything but the block being written.
- Quick open (Cmd-O) for the site's other entries.
- Scratchpad (Cmd-J): a note per entry with the same live preview, in `localStorage` only
  (`mdx-editor:scratch:<collection>/<id>`).
- Changes and commit (Cmd-Shift-G): the entry against HEAD (`@codemirror/merge`), and a Commit button
  (`POST /__edit/api/commit`) that commits only the entry and the images it newly references. No push.
- Live page (Cmd-\\): the collection's `pageUrl` in a pane beside the editor, refreshed by Astro after
  each save.
- `newEntry` collection option.
- Published to npm as `astro-mdx-editor` (MIT): `npm install --save-dev astro-mdx-editor`, then
  `import mdxEditor from 'astro-mdx-editor'`. `npm run build` compiles `dist/`, and runs on `npm pack`.

### Fixed

- CodeMirror's zero-width cursor anchors (`<img>`) picked up a site's `img` border, showing faint marks
  around links and headings.
- A click in a rendered component's empty padding snapped to the nearest text (a label prop) and opened
  the props popover; it now enters the component.
- Code blocks inside callouts used the callout's font.
- A block inserted on an empty, unindented line (an image, a slash-menu block) put the cursor past the
  inserted text.
