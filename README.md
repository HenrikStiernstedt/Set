# Set Gallery

A local-first Set game built with Vue 3 and Node.js. See [SPEC.md](SPEC.md) for product requirements and [BUILD_PLAN.md](BUILD_PLAN.md) for implementation milestones.

## Requirements

- Node.js 20 or newer
- npm

## Install

```sh
npm install
```

## Run during development

Open two terminals in the project directory:

1. Start the backend: `npm run server:watch`
2. Start Vite: `npm run dev`

Open the local Vite URL printed in the second terminal (normally `http://127.0.0.1:5173`). Vite proxies `/api` to the Node service on `127.0.0.1:3001`.

The backend is deliberately loopback-bound in this milestone. LAN hosting will be introduced in a later phase; gallery editing/admin operations are intended to remain local-only.

## Build and verify

- `npm test` — run Node's built-in test runner.
- `npm run build` — compile the Vue frontend into `dist/`.
- `npm start` — serve the production build and API at `http://127.0.0.1:3001` (run `npm run build` first).

## Starter gallery

`galleries/starter/set-gallery.json` demonstrates the manifest structure. It intentionally has no card images yet, so it appears in setup but is not playable until the folder contains correctly tagged images. The gallery editor and tagging tools are planned for a later milestone.

## Current solo game slice

The setup screen lists galleries under `galleryRoots`, lets you choose four categories and three values per category, checks all 81 combinations, and blocks incomplete decks with missing-combination diagnostics and alternative value suggestions. The solo board supports 12/15 starting cards, Set checking, mistakes, replacement cards, Deal 3 when the board has no Set, target/exhaustion completion, restart, timer, and the match reward lightbox.

For now, to supply a playable gallery, create or provide a folder under the configured roots with a schema-version-1 `set-gallery.json` and supported image files. Every selected category/value tuple must have a usable image. See [SPEC.md](SPEC.md) for the manifest format. This milestone does not include the visual gallery authoring editor yet.
