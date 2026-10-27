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
