# Set Gallery — Incremental Build Plan

This plan breaks the specification into independently testable milestones. Complete one milestone at a time, validate it, and save a checkpoint before starting the next. Do not ask an agent to implement the entire specification in one pass.

## Working method (to keep work resumable)

At the start of each milestone, read `SPEC.md` and this plan, then inspect the current code before editing. Keep the active milestone narrow. At its end:

1. Run the milestone's tests and build; fix regressions before moving on.
2. Update the checklist below and add a short **Checkpoint log** entry: what changed, tests run/results, decisions made, and known issues.
3. Commit the working milestone (or make a backup checkpoint if version control is not initialized).
4. Start the next milestone in a fresh conversation if useful, referring to these two documents and the first unchecked phase. Do not reimplement completed phases.

Each phase should use a separate plan → implementation → validation loop. Prefer small vertical slices (API + UI + tests) over writing the whole backend, then the whole frontend. Keep game rules in pure/testable domain functions, filesystem/network access behind server services, and Vue components focused on UI.

## Milestones

### 0. Repository and product-contract preparation

- Initialize version control and scaffold Vue 3 + Vite and Node.js server with minimal dependencies.
- Add scripts for development, production build, server start, and automated tests.
- Define runtime config/data paths; default bind is loopback. Add separate local-only guard middleware before any editor/admin endpoints exist.
- Add sample gallery fixtures and document how to run the project.
- Reconcile any specification contradictions discovered during implementation before coding dependent behavior.

**Done when:** clean install/build works, server serves the Vue app, health endpoint responds, tests run, and loopback-only protection has an automated test.

### 1. Gallery manifest loading and game-readiness validation

- Define/validate manifest schema version 1, IDs, categories/values, card records, paths, and supported image files.
- Implement configured root discovery and safe canonical path resolution, including symlink/traversal rejection.
- Implement selected four-category + three-value choices, 81-tuple coverage, duplicate-candidate reporting, missing tuple diagnostics, and ranked alternative value triples.
- Implement warning analysis for unselected category variation.
- Serve safe category/setup summaries to remote room setup without exposing paths or filenames.

**Done when:** fixtures cover complete, incomplete, duplicate, invalid-path, broken-image, extra-category, and extra-value cases; unit tests pass and no absolute path leaks in remote-safe responses.

### 2. Solo game vertical slice

- Implement shuffle/deal, selection, Set validation, invalid selection, match/replacement, Deal 3/no-set handling, target/exhaustion completion, restart, timer, and solo-only reward lightbox.
- Use opaque per-game image tokens from the start; never expose source filenames to gameplay clients.
- Build a responsive keyboard-accessible Vue game screen with reduced-motion support.

**Done when:** a complete game can be played end-to-end from a fixture gallery; pure rules tests and browser-level smoke tests pass.

### 3. Local gallery authoring editor

- Implement a loopback-only gallery viewer and diagnostics screen: browse all cards, sort/group by category/value, filter missing values, duplicate hashes, duplicate filenames, invalid feature objects, and incomplete card records. Add a lightweight inspection panel showing each image’s category/value state and its file path within the gallery tree before editing.
- Add a fullscreen lightbox for the gallery view: click a card to open a larger image overlay, support close/escape, show the current subfolder and filename, and support next/previous browsing in the filtered gallery with keyboard arrow controls.
- Implement category/value create/rename/delete, file browser, explicit rescan, single/batch manual tagging, previews, conflict choices, safe manifest writes/backups, and external-edit detection.
- Implement desktop file drop as preview/apply: content-match dropped bytes against all gallery assets, reuse a unique existing asset, ask when duplicate identical files are ambiguous, and copy only new content. Ensure cancel/expiry cleans staged data.
- Keep file path/manifest mutation checks enforced server-side, not merely hidden in Vue.

**Done when:** tests prove local vs remote access boundaries, the gallery browser surfaces missing values and duplicate records, the lightbox can open/close cleanly and navigate filtered cards with keys/buttons, repeated drop reuses the existing record, genuinely new images import once, ambiguous duplicates require a choice, cancellation leaves no gallery changes, and manifest writes survive malformed/external-edit scenarios safely.

### 4. Filename-based tagging

- Implement per-gallery delimiter/position profile and preview/apply flow.
- Parser order: remove extension → truncate at first `-` → split by delimiter → remove decimal-only tokens and exact `[vV][0-9]+` tokens → map remaining positions.
- Match IDs/labels/aliases case-insensitively after Unicode normalization. Report unknown, missing, shifted, and ambiguous values; never silently invent tags.
- Make applying idempotent and use the same overwrite/ignore/cancel assignment flow.

**Done when:** parser tests cover the examples and edge cases (suffix, `v1`, `V2`, `v1blue`, numeric-only token, unknown alias, delimiter edge cases); preview is read-only and applying twice creates no duplicate records.

### 5. Permanent history, setup lists, and image voting

- Persist every started solo game and multiplayer round, score/mistake updates, completion/abandonment/interruption, UTC times, duration, setup label snapshots, player data, game code/session/round.
- Implement local-only history query/clear, popular and last-played setups derived from history, and session-round totals.
- Implement durable per-gallery-card per-normalized-username votes (rating, Weird, Interesting), own-vote retrieval, creator-only aggregate/detail views, and local-only clear/export.
- Give guests clear notice before accepting that names and scores/mistakes are permanently recorded. Treat username voting as unverified identity.

**Done when:** restart/recovery tests verify history survives and active boards do not restore; history-derived lists agree with records; vote updates replace previous votes and access-control tests pass.

### 6. Multiplayer room/lobby and live spectator transport

- Implement opt-in LAN/hosted bind mode, share URL generation, high-entropy room codes, separate host capability and participant reconnect token.
- Implement waiting/active/finished/expired room lifecycle, named accept flow, anonymous spectators, host-only setup/start, and roster freeze.
- Use HTTP actions + per-room Server-Sent Events. Publish versioned public state snapshots/events only; keep selections and secrets private. Enforce remote gallery editor/admin denial independently of room host permissions.

**Done when:** two or more devices can join a reachable host, accept or spectate, receive live lobby/start/game state, reconnect from a snapshot, and prove spectator/guest APIs cannot read secrets or mutate setup.

### 7. Multiplayer gameplay and same-code rounds

- Implement per-player private selections, atomic claims, stale-claim handling, score/mistake tracking, Deal 3, win/tie/exhaustion rules, disconnect/reconnect behavior, and persistent final scoreboard.
- Keep result screen until host chooses **Create New Game**; same code/session, increment round, editable previous setup, re-accept returning players, allow roster changes.
- Add optional non-modal player trophies; no automatic multiplayer lightbox. Add Random vs Prefer unplayed image setting and per-session temporary image-use memory across rounds (not persisted across restart). Apply bounded popularity preference only within equal usage tier.
- Record every round durably and preserve accumulated session totals in history.

**Done when:** automated concurrency tests show one score per accepted Set; end-to-end tests cover replay, roster changes, session totals, trophies, image variants, room expiry, and server restart semantics.

### 8. Hardening, accessibility, and release readiness

- Run full API/path/security review: loopback detection, proxy/header spoofing, CSRF/origin, rate limits, room-code entropy, opaque asset token scope, no filename leaks, cache headers, upload limits, and error redaction.
- Test manifest/history corruption recovery, atomic writes, large galleries, malformed requests, expired rooms, and no-network local operation.
- Check keyboard-only use, focus handling, contrast, responsive layout, reduced motion, and browser error states.
- Document config, gallery format, local/LAN setup, backup/restore, history/vote deletion, and known limitations.

**Done when:** clean install, automated tests, production build, manual solo/LAN checks, and documentation checklist all pass.

### 9. Add all hints and cheats

- Define separate cheat and hint groups, each with clear names and a consistent in-game button set.
- Add cheat modes with catchy names:
  - "Reveal one" — highlight one card that can participate in a valid Set with the current selection or board state.
  - "Reveal two" — highlight a second card that completes a valid pair with the first revealed card.
  - "Reveal three" — highlight the third card to complete a Set; keep this as a debug/test-only mode by default and ensure it is not enabled in standard production play.
  - "Highlight category" — highlight every card matching a chosen category value.
  - "Fade invalid" — when two cards are selected, fade or disable cards that cannot participate in a valid Set; this is a strong assist and should be treated as a cheat mode.
- Add hint modes with friendlier names and more standard UI treatment:
  - "Highlight new cards" — emphasize newly dealt cards or recently revealed cards as likely Set candidates.
  - "Show category overlay" — render a category/value overlay on cards as a standard visual aid, not a cheat.
- Define the display rules for highlights:
  - "Highlight new cards" uses a large blue glow behind the card to make it easy to see while staying compatible with all other active hints.
  - Reveal hints use a smaller, stronger orange glow behind the card to call attention to the actual Set-solution cards.
  - "Highlight category" does not need to match the reveal visual style and may be used independently; it does not need to be compatible with reveal modes, because those will not be used at the same time.
  - "Highlight new cards" must be compatible with all other active overlays and glow styles and should remain visible alongside them.
  - Fade invalid cards are simple disabled/low-opacity treatment and are trivial to combine with other board highlights.
  - "Show category overlay" overlays the name of the value in each corner for the active categories; this should work even when cards are otherwise highlighted.
- Keep hint and cheat semantics distinct: reveal-based actions are cheat-like and should be reset after a successful match; persistent display hints such as "Highlight new cards" and "Show category overlay" should remain active until the player turns them off.
- Add all hint/cheat buttons directly on the board while a game is active. Buttons must be visible, easy to understand, and reflect whether the mode is persistent or one-shot.
- Preserve the gameplay boundary: hints must remain view-layer-only unless the mode is explicitly marked as cheat and permitted by config; no hint or cheat should mutate board rules, deck state, or selection validation.

**Done when:** the game exposes a visible board-level action set for each hint/cheat, one-shot reveal modes reset after a valid match, persistent display hints stay active when enabled, category overlays render value names in the corners, and cheat features remain off unless explicitly allowed.

### 10. Add configurability

- Add server-level default configuration for which hints and cheats are available globally.
- Add per-set override configuration so each gallery/set can enable, disable, or tighten the allowed modes beyond the server default.
- Require explicit pre-game activation for any cheat or strong hint feature before the board begins; the activation decision must be persisted as part of the game setup/history.
- Record every hint and cheat use in game history, including mode name, category, timestamp, whether it was a hint or a cheat, and whether it was persistent or one-shot.
- Reserve room for a later scoring impact: cheat usage may reduce points, trigger penalties, or otherwise be treated differently from standard assistance.
- Keep the configuration model simple and explicit: default allowed modes, per-set override rules, and pre-game activation state all need to be readable by diagnostics and tests.
- Keep the strong cheat modes disabled by default and do not allow them in standard game settings unless config explicitly permits them.
- Add a testing matrix covering default play, standard hints enabled, cheat modes enabled by config, and deny-list behavior when the set/server policy blocks a cheat mode.

**Done when:** config defaults and per-set overrides are enforced end-to-end, pre-game activation is required for cheat modes, and game history records the selection and use of each hint/cheat mode.

## Checklist

## Checklist

- [x] 0. Repository and product-contract preparation
- [x] 1. Gallery manifest and readiness validation
- [x] 2. Solo game vertical slice
- [x] 3. Local gallery authoring editor
- [x] 4. Filename-based tagging
- [ ] 5. Permanent history, setup lists, and image voting
- [ ] 6. Multiplayer room/lobby and live spectator transport
- [ ] 7. Multiplayer gameplay and same-code rounds
- [ ] 8. Hardening, accessibility, and release readiness
- [ ] 9. Hints, cheats and assistive overlays
- [ ] 10. Cheat controls

## Checkpoint log

- Milestone 0 complete: scaffolded Vue 3/Vite frontend and a built-in Node HTTP server; added loopback peer-address guard (including IPv4-mapped IPv6), health routes, starter manifest, example config, README, and npm scripts. No game/editor logic is implemented yet.
- Validation: `npm test` passed (4 security tests); `npm run build` passed; production server served the page at `http://127.0.0.1:3001/` and the UI reported the local health API online. Server was stopped after the smoke test.
- Decisions: use Node built-in HTTP instead of Express; use system fonts so the shell has no external runtime font dependency; keep Vite and server as separate terminal commands during development.
- Checkpoint commit: `9b50aff` — `Scaffold Set Gallery milestone 0`.
- Milestone 1 complete: added schema/path validation, configured-root gallery scanning, selected-category readiness, missing/duplicate tuple diagnostics, alternative value suggestions, variation warnings, and safe gallery APIs. Path traversal and unsupported/missing image cases are covered.
- Milestone 2 complete: added pure Set/game rules, shuffled 81-card deck creation, opaque per-game image tokens, match/mistake handling, replacement cards, Deal 3/no-Set rules, target/exhaustion completion, restart, and the solo Vue setup/board/reward UI.
- Validation after milestones 1–2: `npm test` passed (22 tests, including temporary complete gallery API integration); `npm run build` passed; browser smoke confirmed the setup screen loads and category selection works. There is no bundled playable image gallery yet: the starter gallery remains intentionally empty until the editor milestone or user-provided folder supplies 81 combinations.
- Known scope: game state is in-memory only until the history milestone. Solo game endpoints are loopback-only; multiplayer APIs arrive later.
- Checkpoint commit: `133fe77` — `Implement solo Set game vertical slice`.
- Milestone 3 local gallery authoring editor was deferred by the user while filename tagging was implemented directly against existing configured folders.
- Milestone 4 implemented ahead of the editor at the user's request. Added filename extension/hyphen/numeric/vN parser rules, profile mapping API, whole-gallery dry-run preview, shared unknown-token-to-value mapping saved as aliases, per-image conflict overwrite/ignore and skip decisions, and atomic manifest backup/write. Added an optional filename-tagging panel on the game setup screen so existing image folders can be tagged before the full editor.
- Validation: `npm test` passed (29 tests covering parser exceptions, unknown token alias mapping, existing invalid card repair, conflict decisions, idempotency, batch-wide mappings, and preview/apply HTTP routes); `npm run build` passed. Browser smoke previewed all 81 Hedgehogs image files and surfaced `1h` and `0f` as unknown tokens for the user to map.
- Known scope: full gallery editor milestone 3 remains deferred by user request. Filename tagging only previews/applies existing supported images in the configured gallery; it does not create categories or values or import files.
- Checkpoint commit: `ab9fb2d` — `Implement filename-based gallery tagging`.
- Follow-up UX fix: canonicalize the active four game categories to their order in `set-gallery.json`, independent of selection click order. Regression test added; `npm test` passed (30 tests) and `npm run build` passed.
- Category-order checkpoint commit: `8463da1` — `Preserve gallery category order in games`.
- Setup default behavior: on gallery selection, preselect all categories and all values; users uncheck down to four categories and three values per category. Readiness checks immediately for the initially selected setup. Verified in browser with the 81-card Hedgehogs gallery; all 30 tests and production build pass.
- Gallery viewer/editor slice started: the creator-only gallery view now supports opt-in browsing, filters by category/value and diagnostics, sort controls, and a fullscreen lightbox showing the exact file path/folder plus next/previous traversal with arrow keys.
- Gallery editor mutation slice complete: added explicit per-card editing from the viewer lightbox, manual category/value assignment with required overwrite/ignore conflict decisions, and replacement-image drop/file selection. Server validates card/category/value IDs, canonical image/root containment, image type/signature and upload size; replacement changes only the image reference, preserving all other card properties. Manifest writes now share serialized atomic backup persistence and reject invalid/external stale edits.
- Validation: `npm test` passed (36 tests, including assignment conflict/validation, replacement metadata preservation and bad-content rejection, stale external-edit protection, and local editor API routes); `npm run build` passed; editor files report no errors.
- Remaining milestone 3 work: category/value create/rename/delete, file browser and explicit rescan workflows, and completing the staged desktop-import preview/apply lifecycle and its ambiguity/cancel cleanup requirements. Milestone 3 remains unchecked.
