# Decisions

Short records of choices that shaped the design. The newest are at the bottom.

## 1. The `.mdx` text is the source of truth (2026-10-27)

**Decision.** Live preview over the raw text (CodeMirror 6 decorations), not a WYSIWYG document model.
**Why.** Hand-written MDX should round-trip byte for byte, so git diffs stay clean. WYSIWYG editors
(ProseMirror, MDXEditor) re-serialise the file and reformat it.

## 2. Runs inside the site's dev server (2026-10-27)

**Decision.** An Astro integration that is active only during `astro dev`, rather than a desktop app or an
IDE extension.
**Why.** Most components are server-only `.astro` files, so only the site's own server can render them
faithfully. Running in the site also brings its real CSS, fonts and tokens.

## 3. Components edit in "mode A": styled frame (2026-10-27)

**Decision.** When the cursor is elsewhere, a component block shows its real render. With the cursor
inside, the tags collapse to a props chip and the inner Markdown is live-preview prose in a neutral
frame. `</>` toggles raw MDX.
**Why.** The author chose it after trying a prototype with three modes (A frame, B rendered and flip, C real
shell).

## 4. Rendering through the Container API (2026-10-27, phase 0 spike)

**Decision.** Snippet `.mdx` files are loaded with the SSR environment's module runner and rendered with
`experimental_AstroContainer` plus the MDX renderer.
**Why.** This uses the site's real MDX and satteri pipeline (callouts, emoji) and its globally available
components. Measured at 1–10 ms per block, with output identical to the published page.

## 5. Block markers hang in the margin (2026-10-27)

**Decision.** Revealed `##`, `>` and list markers are positioned in the left margin instead of inline.
**Why.** In the prototype, inline reveals shifted text as the caret arrived, so clicks landed off, worst
in callouts. With nothing moving, a click resolves against the layout the user actually saw.

## 6. Heading shortcuts are Cmd-Alt-1…3 (2026-10-27)

**Decision.** Use Cmd-Alt-digit (as Google Docs does), not Cmd-digit.
**Why.** Browsers keep Cmd-1…9 for switching tabs, and a page can't intercept them.

## 7. Click-accuracy test runs in the page (2026-10-27)

**Decision.** `?selftest` runs a click-accuracy harness in the real editor page, rather than vitest browser
mode with Playwright.
**Why.** It tests the real site CSS and fonts with no extra browser download. It can be driven from any
browser, including the built-in one used for checks.

## 8. Full reloads are routed per tab (2026-10-27)

**Decision.** Wrap Vite's HMR channel so that editor tabs get a custom reload event (with kind `content` or
`code`) instead of a raw full reload. All other tabs are unaffected.
**Why.** Astro reloads every open page whenever any content file changes, so each autosave would
reload the editor and lose the cursor. Making the editor page independent of `astro:content` doesn't
help: the reload is sent to every page (`path: '*'`), and a second one comes from the SSR module graph.
Wrapping the channel relies on Vite internals (`server.ws.clients`, `send`), so it's kept in one small
file.

## 9. Parse Markdown the way MDX does (2026-10-27)

**Decision.** Turn off Lezer's indented-code rule.
**Why.** MDX has no indented code blocks. Component children are often indented 4 spaces (`<Note>` in
_judging_), and those are prose, not code.

## 10. Sites load the editor from a sibling checkout (2026-10-27)

**Decision.** Site configs import `../astro-mdx-editor/src/index.ts` when that folder exists, instead of
depending on it through npm (`file:`).
**Why.** A `file:` dependency ends up in the lockfile, and `npm ci` on the deploy runner fails when the
path doesn't exist. The editor is a local, dev-only tool; machines without it should just build the site.

## 11. A hand-written component scanner, not a full MDX parse (2026-10-27)

**Decision.** `src/client/jsx.ts` scans for capitalised JSX elements synchronously on every change,
instead of running micromark + mdast-util-mdx in a worker as planned.
**Why.** Decorations need element boundaries on every keystroke and cursor move, with no latency.
Mid-typing MDX is often invalid, and a real MDX parse fails as a whole, while the scanner just leaves
the unfinished tag raw. Rendering still goes through the real MDX pipeline.

## 12. No vertical margins on block widgets (2026-10-27)

**Decision.** Frame headers and footers and rendered blocks use padding, never vertical margins.
Rendered blocks are `display: flow-root`, so the component's own margins stay inside.
**Why.** CodeMirror measures widgets without their margins, and its height map then disagrees with
the page. The click test caught this: two nested frames at phone width put clicks 16px, a whole line,
off.

## 13. Raw mode is temporary, and tags edit raw (2026-10-27)

**Decision.** `</>` / Cmd-Enter shows an element as raw MDX only until the cursor leaves it. A cursor
inside a tag (from search or undo) also shows that element raw. Self-closing and
empty elements always edit raw.
**Why.** That matches "the cursor elsewhere shows the render" without a mode to remember. It also lets
props be edited directly until the props editor lands in phase 4.
**Revised in phase 4 (see 17).** Self-closing elements are edited through the props popover, and empty
elements get a frame to type into. A cursor in a tag still shows it raw.

## 14. Callout looks are measured from the site, not restyled (2026-10-27)

**Decision.** The editor renders one callout of each type through the site's pipeline into a hidden
probe inside Prose and copies the computed styles (background, borders, radius, padding, title and
body type, icon) into CSS variables on the card's lines.
**Why.** Prose's callout rules (`.prose .callout > .callout-title`) need DOM the editor can't have, and
each site styles callouts differently. Measuring gives an exact match for any site and theme, the
site's own icons, and the types it actually renders as callouts.

## 15. Callout markers and emoji are atomic and never expand (2026-10-27)

**Decision.** `[!type] ` is an icon widget and `:shortcode:` an emoji widget, whether or not the cursor
is near. The caret steps over them, and Backspace deletes them whole. A callout's type changes through
a picker (Cmd-Shift-C or a click on the icon).
**Why.** Expanding them under the cursor, as Obsidian does, shifts the text the user just clicked on
(design rule: reveals never move text). Treating an emoji as one character is also how it reads.

## 16. Props come from parsing the component's source, not type-checking (2026-10-27)

**Decision.** The registry reads each component with the TypeScript parser alone: `interface Props` in
an `.astro` frontmatter, or the first parameter's type of a React component, plus the defaults in its
destructuring and the JSDoc on each prop and on the component. A prop's editor follows its written
type: a string-literal union is a select, `string` text, `number` and `boolean` their inputs, and
anything else an `{expression}`.
**Why.** A type checker would need the site's whole program and takes seconds; the parser takes
milliseconds and only needs the one file. The components in both sites write their props as plain
interfaces, which is the case that matters. A type it can't read (an imported alias) falls back to an
expression, which is always correct to write.

## 17. Components are inserted the way the collection writes them (2026-10-27)

**Decision.** The slash menu writes a component in its most common form across the collection (a block
with blank lines, one line, or self-closing), with its required props in the collection's usual quote
style. With no usage to go on, a component without a slot is self-closing and one with a slot is a
block. Required props open the popover straight away. A component other entries import gets their
import line (re-pathed for this entry). Empty elements get a frame, so the inserted block is ready to
type into, and so does a blank line the cursor is on between a block's tags.
**Why.** Each site has its own conventions (`word='x'` and blank lines in thoughts, `variant="x"` and
indented children in the notebook). Copying what's already there keeps new text consistent without
a per-component config.

## 18. Frontmatter edits rewrite one field's text, never the whole YAML (2026-10-27)

**Decision.** The panel and the page fields change the frontmatter through `fieldEdit`: the YAML is
parsed (the `yaml` package) only for node ranges, and an edit replaces one value's text, adds one
key's line (after the nearest earlier key in schema order), or removes one key's lines. A replaced
scalar keeps its quote style; a list keeps flow style. YAML that doesn't parse is only editable as YAML.
**Why.** Re-serialising the document, even with the Document API, folds long lines (the dek), and can
change quoting and spacing in keys nobody touched. Editing ranges keeps the rule that the file changes
only where the user changed it.

## 19. The schema comes from the site's zod schema, docs from its comments (2026-10-27)

**Decision.** `GET /schema` imports the content config through the dev server's SSR runner and converts
the collection's schema with zod's `toJSONSchema` (input side, dates as `format: date`, `image()` as a
string path). Field docs are the JSDoc comments above each field in the config, read with the
TypeScript parser, since the sites document fields with comments rather than `.describe()`.
**Why.** The schema the site validates with is the one the form should follow, with no copy to drift.

## 20. Page fields are opted into by the site (2026-10-27)

**Decision.** Any element in the Shell's page with `data-mdx-field="<key>"` (dotted for nested keys)
edits that frontmatter field in place. In thoughts the essay layout sets it on the title and dek, only
when rendered for the editor. The frontmatter itself collapses to a one-line bar in the text; a click
opens the side panel, and `</>` (or a search match inside it) shows the YAML.
**Why.** Which element shows which field is the site's knowledge, and the attribute keeps it next to
the markup. The rest of the header (chip, date) is composite and stays as rendered until a reload.

## 21. Images are files in the site, inserted by the site's snippet (2026-10-27)

**Decision.** A pasted or dropped image is written into the site's source tree (`images.dir`), never
inlined as a data URL or put in `public/`, and the site's `images.snippet` decides the MDX: thoughts
writes `![alt](…)`, which Astro optimizes as a relative Markdown image; the notebook imports the file and
passes it to `<Figure src={…}>`. The snippet runs on the server (it's a function in the site's config);
the alt text is marked with a placeholder character while it runs, so the editor can select it however
the snippet wraps it.
**Why.** Images then go through Astro's image pipeline like hand-added ones, the file stays readable
MDX, and each site keeps its own convention for images without the editor knowing it.
