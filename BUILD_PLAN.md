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

- Implement loopback-only editor screens and endpoints, category/value create/rename/delete, file browser, explicit rescan, single/batch manual tagging, previews, conflict choices, safe manifest writes/backups, and external-edit detection.
- Implement desktop file drop as preview/apply: content-match dropped bytes against all gallery assets, reuse a unique existing asset, ask when duplicate identical files are ambiguous, and copy only new content. Ensure cancel/expiry cleans staged data.
- Keep file path/manifest mutation checks enforced server-side, not merely hidden in Vue.

**Done when:** tests prove local vs remote access boundaries, repeated drop reuses the existing record, genuinely new images import once, ambiguous duplicates require a choice, cancellation leaves no gallery changes, and manifest writes survive malformed/external-edit scenarios safely.

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

## Checklist

- [x] 0. Repository and product-contract preparation
- [ ] 1. Gallery manifest and readiness validation
- [ ] 2. Solo game vertical slice
- [ ] 3. Local gallery authoring editor
- [ ] 4. Filename-based tagging
- [ ] 5. Permanent history, setup lists, and image voting
- [ ] 6. Multiplayer room/lobby and live spectator transport
- [ ] 7. Multiplayer gameplay and same-code rounds
- [ ] 8. Hardening, accessibility, and release readiness

## Checkpoint log

- Milestone 0 complete: scaffolded Vue 3/Vite frontend and a built-in Node HTTP server; added loopback peer-address guard (including IPv4-mapped IPv6), health routes, starter manifest, example config, README, and npm scripts. No game/editor logic is implemented yet.
- Validation: `npm test` passed (4 security tests); `npm run build` passed; production server served the page at `http://127.0.0.1:3001/` and the UI reported the local health API online. Server was stopped after the smoke test.
- Decisions: use Node built-in HTTP instead of Express; use system fonts so the shell has no external runtime font dependency; keep Vite and server as separate terminal commands during development.
- Checkpoint commit: `9b50aff` — `Scaffold Set Gallery milestone 0`.
- Next: milestone 1, gallery manifest loading and game-readiness validation.
