# Working on astro-mdx-editor

Read [ARCHITECTURE.md](ARCHITECTURE.md) first, and record new design choices in
[docs/DECISIONS.md](docs/DECISIONS.md).

## Ground rules

- **Never change the text.** No feature may rewrite, normalise or re-serialise the document. Edits happen
  only where the user acted. `npm run roundtrip` must stay clean.
- **Dev only.** Every hook returns early unless `command === 'dev'`.
- **Every API endpoint is token- and origin-checked.**
- **TypeScript is erasable-only** (`erasableSyntaxOnly`): Node runs the integration directly. Use `.ts`
  extensions in relative imports.
- **Match the house style:** Prettier config in `.prettierrc` (4 spaces, single quotes, width 120).

## Checking changes

```sh
npm test && npm run typecheck
npm run roundtrip -- ../thoughts ../engineering-notebook
```

Then run `astro dev` in a linked site and open `/__edit/<collection>/<id>?selftest` to run the
click-accuracy test.

**Server code changes need a full restart** (`astro dev stop`, then start it again). Node caches the
integration module for the life of the process, and touching `astro.config.mjs` doesn't reload it.
Client code (`src/client/`) hot-reloads normally.

**Debugging reload routing:** start the dev server with `MDX_EDITOR_DEBUG=/path/to/log` to log HMR hellos
and each full reload's classification.

## Git

Commit in small, logical steps with clear messages. Update CHANGELOG.md under "Unreleased" as features
land.
