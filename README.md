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

Open the local Vite URL printed in the first terminal (normally `http://127.0.0.1:5173`). Vite proxies `/api` to the Node service on `127.0.0.1:3001`.

The backend is deliberately loopback-bound in this milestone. LAN hosting will be introduced in a later phase; gallery editing/admin operations are intended to remain local-only.

## Build and verify

- `npm test` — run Node's built-in test runner.
- `npm run build` — compile the Vue frontend into `dist/`.
- `npm start` — serve the production build and API at `http://127.0.0.1:3001` (run `npm run build` first).

## Starter gallery

`galleries/starter/set-gallery.json` demonstrates the manifest structure. It intentionally has no card images yet, so it is not playable until images and feature tags are added in a later milestone.
