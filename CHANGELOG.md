# Changelog

## Unreleased

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
