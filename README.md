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

On Windows, run `start-dev.bat` from the project directory. It opens the backend and Vite in separate command windows.

On other platforms, open two terminals in the project directory:

1. Start the backend: `npm run server:watch`
2. Start Vite: `npm run dev`

Open the Vite URL printed in the second terminal (normally `http://127.0.0.1:5173`). Vite proxies `/api` to the Node service using the configured `bindAddress` and `port`.

The server defaults to `127.0.0.1:3001`. For phone testing on a trusted private network, set `"networkMode": "lan"`, `"bindAddress": "0.0.0.0"`, and a `"port"` in `config.json`; `PORT` overrides the configured port. Build and run the backend (`npm run build` then `npm start`), then open `http://<PC-LAN-IP>:<port>` on the phone. LAN mode permits game setup and gameplay and exposes only safe gallery metadata; gallery editing and filesystem APIs remain loopback-only. The Vite dev server remains loopback-bound. LAN mode has no authentication, so do not expose the server to an untrusted network or the internet.

## Build and verify

- `npm test` — run Node's built-in test runner.
- `npm run build` — compile the Vue frontend into `dist/`.
- `npm start` — serve the production build and API at the configured address and port (run `npm run build` first).

## Starter gallery

`galleries/starter/set-gallery.json` demonstrates the manifest structure. It intentionally has no card images yet, so it appears in setup but is not playable until the folder contains correctly tagged images. The gallery editor and tagging tools are planned for a later milestone.

## Current solo game slice

The setup screen lists galleries under `galleryRoots`, lets you choose four categories and three values per category, checks all 81 combinations, and blocks incomplete decks with missing-combination diagnostics and alternative value suggestions. The solo board supports 12/15 starting cards, Set checking, mistakes, replacement cards, Deal 3 when the board has no Set, target/exhaustion completion, restart, timer, and the match reward lightbox.

For now, to supply a playable gallery, create or provide a folder under the configured roots with a schema-version-1 `set-gallery.json` and supported image files. Every selected category/value tuple must have a usable image. See [SPEC.md](SPEC.md) for the manifest format. This milestone does not include the visual gallery authoring editor yet.

### Tag existing images from filenames

Select a gallery, open **Tag images from filenames → Configure**, set the delimiter and map each category to a token position, then save the rules. Choose **Preview all gallery images** to review parsed tags. The parser removes the extension, ignores everything after the first hyphen, then skips numeric-only and exact `v`/`V` + digits tokens before mapping positions. Unknown tokens can be mapped once to a value for the whole batch (the mapping is saved as a value alias); if that changes a card's existing value, choose overwrite or keep-existing for that card. Choose **Apply reviewed tags** to register new matching files and update existing records. Preview is read-only; applying writes a backup beside the manifest as `set-gallery.json.bak`.

Filename tagging is available before the full gallery editor milestone. It tags existing files in place and does not copy or rename them.
