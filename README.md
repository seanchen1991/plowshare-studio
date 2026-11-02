# Plowshare Studio

A free, open-source, browser-only studio for recording video podcasts and cutting them into episodes. Recording, storage and editing all happen on your own computer: no accounts, no backend, no uploads.

Supported browsers: the latest Chrome, Edge and Firefox on Windows, macOS and Linux. Safari isn't supported yet.

## Development

Needs Node.js (current LTS or newer) and pnpm (the version is pinned in `package.json`; `corepack enable` picks it up).

```sh
pnpm install
pnpm dev          # dev server at http://localhost:5173
```

### Tests

```sh
pnpm test         # unit tests (Vitest)
pnpm check        # type check (svelte-check)
pnpm exec playwright install chromium   # once, before the first browser test
pnpm test:e2e     # browser tests (Playwright), against a production build
```

Browser tests tagged `@long` (hour-long recordings, crash runs) are skipped unless `LONG_TESTS=1` is set. CI runs them weekly and on demand through the "Long tests" workflow.

### Build and deploy

```sh
pnpm build        # static site in dist/
pnpm preview      # serve the build locally
```

`dist/` is a plain static site: deploy it to Cloudflare Pages or GitHub Pages. The app is served from the domain root (plowshare.studio).

## Project docs

- [`CONTEXT.md`](CONTEXT.md): the project's vocabulary (Session, Recording, Segment, Cut and so on)
- [`docs/plan/Handoff brief.md`](docs/plan/Handoff%20brief.md): the source of truth for phases 1–2
- [`docs/adr/`](docs/adr/): architectural decisions

## License

[AGPL-3.0](LICENSE)
