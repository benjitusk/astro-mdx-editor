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
