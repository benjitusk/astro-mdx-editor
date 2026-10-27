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

| File                         | Role                                                                                                                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/integration.ts`         | The Astro integration. It does nothing unless `command === 'dev'`. It injects `/__edit` and `/__edit/[collection]/[...id]`, adds the Vite plugin, and mounts the API.                                                                                       |
| `src/server/vite-plugin.ts`  | Virtual modules: `shell` (the site's Shell), `globals` (the site's globally available components), `server` (the token and entry reader for pages). It also pins `astro` and `@astrojs/mdx` to the site's copies (`resolve.dedupe`).                        |
| `src/server/entries.ts`      | Maps `collection/id` to a file under the collection's `dir`, refusing anything outside it. Lists entries.                                                                                                                                                   |
| `src/server/api.ts`          | `/__edit/api/*` middleware. Every request needs the per-session token header and a same-origin `Origin`. `PUT /file` is refused with 409 when the file on disk no longer matches the base hash the client saw.                                              |
| `src/server/render.ts`       | `POST /render`: writes a block's MDX (with the entry's imports, made absolute) to a snippet file named by its hash, loads it through the SSR runner and renders it. Results are cached by snippet; the cache clears when any non-entry source file changes. |
| `src/server/render-entry.ts` | Runs inside the SSR runner: the Container API plus the MDX renderer, rendering with the site's globals as `components`.                                                                                                                                     |
| `src/server/reload.ts`       | Routes full-page reloads per tab: editors get a custom event saying `content` or `code` (see Saving).                                                                                                                                                       |
| `src/server/hash.ts`         | SHA-1 of the file text, shared by the API and the page.                                                                                                                                                                                                     |

**Middleware has to be mounted in `astro:server:setup`.** A Vite plugin's `configureServer` added through
`updateConfig` runs after Astro's page handler and never sees the request (found in the phase 0 spike).

**Component rendering (phase 2).** A block's MDX is written once per hash to
`node_modules/.mdx-editor/snippets/<hash>.mdx` and imported with
`server.environments.ssr.runner.import()`, so it goes through the site's real MDX pipeline. It's rendered
with `experimental_AstroContainer`, with `@astrojs/mdx/server.js` registered as the `astro:jsx` renderer.

**Loading.** Sites import `src/index.ts` from a sibling checkout (see README), not from npm, so their
lockfiles and CI never reference this repo. The client's dependencies stay in this repo's `node_modules`.
The integration excludes them from the site's dependency optimizer (which resolves from the site root
and can't find them), and Vite serves them as plain ES modules, one copy each.

## Client (browser, bundled by the site's Vite)

| File                        | Role                                                                                                                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/client/main.ts`        | Reads the page's data attributes and the JSON doc, then builds the editor.                                                                                                                                                                   |
| `src/client/editor.ts`      | Assembles the CodeMirror state and view: Markdown language, live preview, keymap, typography, paste, save.                                                                                                                                   |
| `src/client/meta.ts`        | Finds the frontmatter and the top-of-file `import`/`export` lines, which Lezer doesn't understand, so other modules leave them alone.                                                                                                        |
| `src/client/jsx.ts`         | A synchronous scanner for component elements (capitalised tags), classified as `block`, `line`, `void` or `inline`. It tolerates half-typed MDX: an unclosed tag stays raw and its children still count.                                     |
| `src/client/components.ts`  | Mode A: rendered widgets when the cursor is elsewhere, a frame with a props chip when it's inside, raw MDX on `</>`, Cmd-Enter or a cursor in a tag. Also fetches renders, and handles arrow keys in and out and the Backspace/Delete guard. |
| `src/client/textmap.ts`     | Maps a click in rendered HTML back to the source: normalise both sides, then look up the text around the click.                                                                                                                              |
| `src/client/livepreview.ts` | A `StateField` of decorations built from the Lezer Markdown tree (see "Live preview" below).                                                                                                                                                 |
| `src/client/commands.ts`    | Every command in one table: id, label, default key, `run`. The keymap, palette and cheat sheet are all built from it.                                                                                                                        |
| `src/client/typography.ts`  | Smart quotes, dashes and ellipsis, each its own undo step and skipped in code, JSX and frontmatter.                                                                                                                                          |
| `src/client/paste.ts`       | A URL pasted over a selection makes a link. HTML is converted to Markdown with turndown. Cmd-Shift-V pastes plain text.                                                                                                                      |
| `src/client/save.ts`        | Autosave, status, conflict banner, external-change reload.                                                                                                                                                                                   |
| `src/client/palette.ts`     | The command palette and cheat sheet (`<dialog>`).                                                                                                                                                                                            |
| `src/client/selftest.ts`    | The in-page click-accuracy test (`?selftest`).                                                                                                                                                                                               |
| `src/client/editor.css`     | Editor styles, built on the site's design tokens (`--space-*`, `--accent`…) with fallbacks.                                                                                                                                                  |

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
  hidden prefix to the content side of it.

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
