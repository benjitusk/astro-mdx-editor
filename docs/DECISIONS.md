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
