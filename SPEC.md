# Set Gallery — Project Specification

## 1. Purpose

A local web app for solo Set games and invite-only multiplayer games using image-based cards supplied by the user. Each gallery folder contains a JSON manifest describing its categories, values, card images, and feature tags. The app validates a gallery, constructs a complete 81-card deck, and provides a polished game UI. A permanent local history records every started game and its results; active multiplayer rooms are transient and close if the server restarts.

## 2. Recommended implementation

- **Frontend:** Vue 3 with Vite, using native browser APIs and CSS; no UI component library required.
- **Backend:** Node.js local HTTP server. Use Node's built-in HTTP and filesystem APIs for the first version; avoid a database and unnecessary plugins.
- **Storage:** Gallery manifests and image assets remain in user folders. App configuration and game statistics live in an app-owned data directory, never in the gallery folder.
- **Runtime:** By default, the server binds to `127.0.0.1` for solo use. An explicit network-host mode is required for other devices to connect; see the multiplayer networking requirements below.
- **Gallery editing access:** The gallery editor and all filesystem/manifest mutation operations are local-only, restricted to requests originating from loopback. This avoids adding password/account management to the MVP. Network-connected users may host games using existing configured galleries through the separate room setup flow, which grants no editing rights.

A normal browser page cannot freely enumerate arbitrary computer folders. The local Node service is therefore required for folder access and persistent statistics. For the first version, the user explicitly configures a small allowlist of trusted gallery root folders in `config.json`; the app may list gallery manifests found inside those roots. The web UI/API must not expand this allowlist or accept arbitrary filesystem paths. The Gallery Editor, file browser, image imports, rescan, and all manifest/category/value/tag assignment writes are restricted to loopback clients, even when multiplayer hosting is enabled. A native folder picker could be added later, for example by packaging the app as a desktop app, but is not required for the MVP.

## 3. Game and deck rules

### Multiplayer rooms

- A player can create a multiplayer room and becomes its **game master**. The server creates a unique, hard-to-guess room code and displays a shareable URL such as `/game/DJGH/` (the route shape is illustrative; production codes should have sufficient entropy). Guests opening that URL on another device enter the room lobby.
- While the room is waiting, only the game master can select the gallery, categories, three values per category, starting board size, and target score. Guests cannot change setup. Setup must pass the same 81-combination validation as a solo game before the master can start.
- The game master is included as a player and must have a non-empty display name (pre-filled from the name cookie or a default that the host can edit). Each guest must enter a non-empty display name and explicitly press **Accept** to join. A blank name or merely opening the URL does not join the roster. Trim whitespace, enforce a reasonable length (for example, 1–24 characters), reject control characters, and display names as text (never HTML).
- The lobby shows named participants, their accepted/ready state, and the four active categories/value triples selected by the host. Anyone opening the room URL without accepting is a read-only spectator: no name is required, they are not added to the player roster, and they do not count toward the minimum player count. On **Start**, the server freezes the roster to the game master and guests who accepted with valid names. Require at least two named players (the game master plus one accepted guest) to start multiplayer. Non-accepted visitors remain spectators and can watch the active game live but cannot join that round as players.
- The chosen name is saved in a same-origin cookie for future games. The cookie is only a convenience for pre-filling the name and is not authentication or proof of acceptance. Before **Accept**, tell guests that their display name and game statistics (including scores and mistakes) are permanently recorded on the host's server until its owner clears history. Use appropriate `SameSite` and `Secure` attributes based on HTTP/HTTPS and do not put names or player credentials in the room URL.
- The room code grants access to the lobby/game view, not game-master privileges. Create a separate unguessable host capability bound to the creator's browser session; only that capability can change setup or start the room. Do not expose it in the share URL or guest state/events.
- A room has explicit waiting, active, finished, and expired states. If the game master disconnects before starting, the room remains reserved for that host session until expiry; guests cannot take over. Active/finished rooms expire after a configurable idle timeout. Restarting the server closes all active multiplayer rooms cleanly.
- After a round finishes, keep its room code and host capability active until room expiry so the same game master can choose **Play Again** without creating a new invite URL. A replay starts a fresh round with a newly shuffled deck and reset board, timer, per-round scores, and per-round mistakes; it reuses the last setup as editable defaults. Returning participants must confirm/accept for the new round; visitors remain spectators unless accepted before the host starts. The game master may also change setup before replay. Accumulated session scores persist across rounds under the same room session. The room code does not remain usable after expiry or a server restart, but its value and round history remain in permanent game history.
- For a multiplayer rematch, show a host-controlled image selection option: **Random images** or **Prefer unplayed images**. Unplayed status is tracked by source image/card ID across rounds in the room session, regardless of which players joined each round. Prefer an unused variant for each feature tuple where available; if all variants for a tuple have been used, fall back to the least-used variant in that session, then randomize ties. If the session's temporary usage memory is unavailable, treat all variants as unplayed. This preference does not change the 81 unique feature tuples or scoring.
- Show a connection state and support reconnecting to the same room. Preserve a temporary per-room participant identity token in a secure, same-origin session mechanism so reconnects do not create duplicate roster entries; it is distinct from the display-name cookie. If reconnect credentials are unavailable, the player re-enters their name and accepts again before start, or is treated as a new spectator after the round begins.

### Multiplayer play and scoring

- Once started, every accepted player sees the same board, deck count, game timer, live score table, and persistent indication of the four active categories/value triples. Each player has their own private three-card selection; partial selections are not broadcast to other players.
- Spectators see a live, read-only view of the public game state (board, deck count, timer, player names/scores, accepted matches, and game outcome). They cannot select/claim cards, request Deal 3, change setup, or affect scoring. They do not need to set a name or accept. Never send spectators private player selections, reconnect/host capabilities, or other secrets.
- Any active player may submit a completed triple. The server is authoritative and processes submissions atomically. The first valid Set accepted for cards still on the board earns one point for that player, removes the cards, deals replacements, and broadcasts the new state. Concurrent claims for cards already removed are rejected as stale and do not change score or mistake count.
- Record each accepted Set against the player who claimed it for the current round, so the player's optional Trophies view can be loaded even after reconnecting and during the finished-score screen. Trophies are not required for scoring, are cleared when the host starts a replay, and are not written to solo statistics.
- An invalid triple clears only that submitting player's selection and does not block other players' attempts. Track per-player invalid attempts for the final summary, but score is based only on successfully matched Sets. Only the player whose valid claim is accepted receives those points.
- Any active player may request **Deal 3** only when the server confirms that no Set exists on the current board; simultaneous requests are serialized so cards are dealt once. Deal up to three remaining cards. Client-side board checks are advisory only.
- The multiplayer round ends when a player first reaches the configured target score, or when the deck is empty and no Set remains on the board. At the target, that player wins. On exhaustion, the highest score wins; tied highest scores are a shared tie. The lobby setup's target defaults to `targetSets` from app configuration and may be changed only by the game master before starting.
- In multiplayer, accepted matches are removed with a brief, non-blocking animation and the updated board/score is broadcast. Do not show an automatic reward lightbox or steal focus after a match. Each player may optionally open a non-modal **Trophies** view during or after play to browse Sets they personally claimed; it must not pause the shared game or change focus automatically. Opening a trophy image in its lightbox shows the four image-voting controls described below. The final score view is separate from this optional feature.
- When the multiplayer round ends, show a persistent final-score screen on every client declaring the winner (or tie) and scores. It remains until the game master explicitly dismisses it by choosing **Create New Game**. No other player or spectator can dismiss it for the room. That action transitions the same room/code to a new waiting round, resets round state, and returns the host to editable setup; until then, clients remain on the final result.
- Only the game master can end/close the room early. A disconnected player remains in the roster and keeps their score; other players can continue. Reconnected participants resume with the same identity when credentials remain valid.
- Every multiplayer round is recorded in the permanent game history separately from solo games. Multiplayer scores never alter solo rankings or settings. The live room/game state remains in memory; durable history and session totals survive server restarts.

### Rematches and image variants

- Solo **Play Again** starts a new game in the same temporary play session, retaining its session ID and the selected setup unless the player changes it. The rematch setup screen visibly offers **Random images** and **Prefer unplayed images**; the player chooses for each rematch. Multiplayer offers the same choice to the game master before each replay.
- A play session groups rematches by one stable session ID: the multiplayer room's internal session ID/public game code, or a generated local-only solo session ID. The player roster may change between multiplayer rounds without ending the session. Track source card/image IDs used in each round in temporary server memory for both modes. Do not use permanent game history to decide whether a variant is unplayed.
- With **Random images**, choose uniformly at random among eligible image variants for each selected feature tuple. With **Prefer unplayed images**, first restrict to variants not previously used in the current session; if none remain, restrict to variants with the lowest session-use count. Within that eligible tier, use the bounded popularity weighting defined under Image voting, randomizing any remaining ties. Each round still uses one image for each of the 81 feature tuples.
- Temporary variant-use memory lasts only for the live session and is discarded when that session expires or the server restarts. Permanent game history remains, but does not contain or restore the full per-card usage memory. A replay after restart starts with all variants considered unplayed.

### Image voting

- Whenever a user opens a card image in a lightbox (including the solo match-reward lightbox, a player-opened card detail view, or a multiplayer Trophies view), show four controls: **👍 Like**, **👎 Dislike**, **Weird**, and **Interesting…**. Never open a voting/lightbox UI automatically in multiplayer.
- Like and Dislike are mutually exclusive per card and username: Like stores rating `+1`, Dislike stores `-1`, and clicking the selected rating again clears it to `0`. Weird and Interesting are independent optional signals, each a per-user on/off toggle; they may both be active because an image can be unusual and still have potential. Users can change or clear their votes at any time.
- Persist one current vote record per gallery card and normalized username, with rating (`-1`, `0`, `+1`), Weird flag, Interesting flag, and updated timestamp. Updating a vote replaces that user's previous values for the card rather than adding another vote. Also derive aggregate counts and net popularity (`sum of ratings`) per card. Do not store votes in the gallery manifest or expose individual voter names/votes to other game clients. The local gallery editor may inspect the complete vote list grouped/filterable by username and card.
- Use the player's chosen display name/username as the voter key, normalized by trimming and case-folding. If no name exists, ask the user for one before accepting a vote. Explain that names are not authenticated: anyone can reuse another username, and identical usernames share/overwrite the same per-card vote. Do not treat voting as a security or moderation mechanism.
- In the local gallery editor, show aggregate ratings and Weird/Interesting counts and allow filtering cards by these signals so the creator can review images. Do not expose aggregate popularity or other players' votes during active multiplayer rounds, since that could influence competitive play.
- For image selection, **Random images** ignores votes and remains uniform. **Prefer unplayed images** first filters by session use as specified above, then applies bounded weighting using net popularity among equally used eligible variants. Use weight `clamp(1 + 0.25 × netPopularity, 0.5, 2.0)` to bias without making any image impossible to choose; do not let popularity cause a previously used card to outrank an unplayed one. Weird/Interesting flags are for creator review only and do not affect automatic selection.
- Vote storage is durable app-owned data separate from game history. It survives game/session expiry and server restarts, and has a local-only clear/export option. Vote write requests validate gallery/card IDs and username length/content; guests may submit/update their own named vote through the game lightbox and retrieve only that vote's current state, but cannot query another user's vote data or clear/export the vote database.

### Popular setup templates

- Derive setup popularity from permanent game-history records by counting started rounds for each exact gallery/category/value setup. Count each round once; merely selecting a setup or opening a room does not count.
- Keep solo and multiplayer popularity lists filtered separately so multiplayer activity does not affect solo popularity lists or rankings.
- In setup, show the most-played valid configurations for the selected gallery and current mode as selectable templates. A template applies its category/value selection to the setup form; all fields remain editable, and validation is rerun before game start.
- A template may reference categories/values that have since been deleted or renamed. Mark it unavailable or partially stale, do not silently substitute values. Templates are derived from history counts rather than manually curated names in the first version.
- Rank by play count descending, then stable setup ID for ties. Limit the initial list to a configurable/top-N number (default 10), with an option to expand the list. Display play count and the category/value labels.

### Permanent game history and multiplayer sessions

- Persist a history record as soon as a game starts, then update it after each scoring or mistake event and when it ends. A game that is restarted, closed early, or interrupted by a server restart remains in history with an explicit outcome/status such as `won`, `completed`, `abandoned`, or `interrupted`; never silently discard a started game. A waiting multiplayer room that never starts is not a played game.
- Each record represents one solo game or one multiplayer round and includes: stable record ID; mode; gallery ID/name; start and end UTC timestamps; elapsed duration in seconds; status/outcome; setup as four category IDs/names and each selected value ID/label; per-player stable-in-session ID, display name, score, successful Sets, and mistakes; plus the room game code and round number for multiplayer. Store label snapshots so history remains readable if gallery categories or values are later renamed/deleted.
- Keep a stable internal multiplayer session ID in addition to the public room code. The same room/code replay increments its round number and accumulates each returning player's session-total score while resetting round scores. Store per-round and per-session totals, and show both on multiplayer result/history views. A room code must not be reused for a different session; after expiry/restart, history can still group rounds by the internal session ID and show the public game code.
- Solo history is not assigned a multiplayer room code. Solo mistakes and scores remain separate from multiplayer records. Popular setup counts and last-played lists are derived from these records, filtered by gallery and mode.
- The history is permanent until the user explicitly clears it; do not auto-prune old records. Provide browsing/filtering for recent games, date range, gallery, mode, setup, outcome, player name, and game code/session. Include **Last Played Setups** sorted by most recent start, with repeat setups grouped and their last-played timestamp/count.
- Store history in the app-owned data directory, never in gallery folders. Use a durable serialized write strategy (for example, an append-only JSONL event/history ledger with recovery for an incomplete final line, or an equivalent transactional store); commit the game-start record and each score/mistake update before acknowledging success. Detect and report corruption, preserve recoverable records, and do not expose history-management APIs to remote guests. Clearing history requires local confirmation and also clears derived popularity/last-played views, but does not edit gallery metadata or live room state.
- The duration is measured by the server's monotonic clock while running; persist UTC start/end timestamps for display. If the process stops during a game, mark it interrupted on next startup using the last durable counters and the time the server stopped/was last able to checkpoint; do not pretend the round was completed.

### Categories and valid gallery setup

A gallery may define any number of categories, but a game uses exactly four selected categories, internally called A, B, C, and D.
- A category may be created before all its values or assignments are complete. To be selectable for a game, it must define at least three distinct values; exactly three of those are then chosen for that game.
- For each of the four selected categories, the player must choose exactly three of its defined values for the game. Categories may define more than three values; values not selected are not used in that game's deck.
- A card's feature values are keyed by category ID, not by display name.
- A valid game deck contains exactly one card for every combination of the four selected value triples: $3^4 = 81$ feature combinations.
- Only source cards whose values belong to all four chosen value triples are eligible. Cards tagged with other values remain in the gallery but are not in this game's deck.
- The four selected categories are the complete rule for that game. Values in every unselected category are ignored by Set validation; a triple that matches the four selected rules is valid even if it appears different in an unselected feature. Make this explicit to every player before and during play by showing the four active category names and selected values; do not imply that all gallery tags participate.
- A gallery may contain more than 81 image records. If several images have the same selected feature combination, the app randomly chooses one as that combination's deck card. This keeps the playable deck unique while allowing a larger source gallery.
- If any combination has no eligible image, game creation is blocked. The UI lists every missing combination and offers the option to change selected categories or values.
- Since images can visibly vary in categories not selected for play, inspect the actual 81-card deck candidate selection for variation in unselected categories. Before starting, show a prominent warning listing any such categories and the values present; require the game master/solo player to acknowledge it. Do not call these invalid sets: they are valid under the explicitly selected four-category rules, but may be visually confusing. Allow the player to change the selected categories/value triples and revalidate.
- Records with invalid paths, missing files, unknown category/value IDs, or missing feature assignments for a selected category are excluded and reported in gallery diagnostics.

### Set rule

The player selects three cards. They form a Set when, independently for each of the four selected categories, the three values are either all identical or all different. A partial match is not a Set.

### Dealing and turn flow

- A new game shuffles the validated 81-card deck and deals the configured starting board size: 12 by default, or 15 when selected.
- The player clicks cards to select them. Selecting a fourth card clears the previous selection and starts a new selection with that card.
- When three cards are selected, the app immediately validates them. A valid Set increments the match count and starts the success animation. An invalid selection increments the mistake count, shows brief feedback, and clears after a short delay.
- On a match, the three cards animate toward the discard area. The player is then shown a reward lightbox with the matched images; dismissing it continues play. The available deck deals up to three replacement cards into the vacated slots. If fewer than three remain, it deals the remainder.
- If no Set is present on the board, a **Deal 3** action becomes available. It deals three cards, or as many as remain. The app can highlight the no-Set state; it must not silently remove or replace cards. There is no board-size cap below the 81-card deck limit.
- If the deck is empty, the player may continue finding Sets on the board. The game ends when no Set remains on the board and no cards remain in the deck, or when the configured win target is reached.
- A restart action confirms before discarding the current game, then starts a fresh shuffle using the same gallery and selected categories.

### Completion and scoring

- `targetSets` is configurable, with a default of **5**. Reaching the target ends the game as a win. The configuration may allow a target from 1 through 27, the maximum number of disjoint triples in an 81-card deck.
- If the deck is exhausted and no Set is available before the target is reached, the game ends as a completed non-win. This is not a technical error.
- Track elapsed time, successful Sets, invalid attempts, gallery name, and selected category/value names. Started games are permanently recorded, including games later abandoned or interrupted; active board/deck state is not restored after restart.
- Present solo history and a compact solo leaderboard: wins first, then shorter elapsed time, then fewer mistakes. Multiplayer history and session scoreboards are shown separately. Abandoned/interrupted games remain in history but do not rank as wins.

## 4. Gallery manifest format

Each gallery has one `set-gallery.json` file at its root. The schema version makes future format changes manageable. The sample below is illustrative; IDs must be unique within their relevant collection.

```json
{
  "schemaVersion": 1,
  "id": "garden-creatures",
  "name": "Garden Creatures",
  "filenameTagging": {
    "enabled": true,
    "delimiter": "_",
    "slots": [
      { "categoryId": "hue", "position": 1 },
      { "categoryId": "count", "position": 2 },
      { "categoryId": "shape", "position": 3 },
      { "categoryId": "texture", "position": 4 },
      { "categoryId": "season", "position": 5 }
    ]
  },
  "categories": [
    {
      "id": "hue",
      "name": "Hue",
      "values": [
        { "id": "red", "label": "Red", "aliases": ["crimson"] },
        { "id": "green", "label": "Green" },
        { "id": "blue", "label": "Blue" }
      ]
    },
    {
      "id": "count",
      "name": "Count",
      "values": [
        { "id": "one", "label": "One" },
        { "id": "two", "label": "Two" },
        { "id": "three", "label": "Three" }
      ]
    },
    {
      "id": "shape",
      "name": "Shape",
      "values": [
        { "id": "round", "label": "Round" },
        { "id": "long", "label": "Long" },
        { "id": "star", "label": "Star" }
      ]
    },
    {
      "id": "texture",
      "name": "Texture",
      "values": [
        { "id": "solid", "label": "Solid" },
        { "id": "striped", "label": "Striped" },
        { "id": "dotted", "label": "Dotted" }
      ]
    },
    {
      "id": "season",
      "name": "Season",
      "values": [
        { "id": "spring", "label": "Spring" },
        { "id": "summer", "label": "Summer" },
        { "id": "winter", "label": "Winter" }
      ]
    }
  ],
  "cards": [
    {
      "id": "card-001",
      "image": "images/card-001.webp",
      "features": {
        "hue": "red",
        "count": "one",
        "shape": "round",
        "texture": "solid",
        "season": "spring"
      }
    }
  ]
}
```

### Image path rules

- Relative paths resolve from the manifest's folder.
- Absolute paths may reference external files only when they are inside a configured allowed root. Relative paths must also resolve within a configured allowed root. The Node service must canonicalize paths (including symlinks) and reject any image path that escapes the roots; it must not trust URL-encoded paths or manifest strings as safe paths.
- Never expose source or stored filenames, folder paths, or filename-derived tags through player-facing game state or image URLs. For game clients, serve images using unpredictable opaque asset tokens mapped server-side to canonical files. Tokens must not be hashes/encodings of filenames or paths, must be scoped to the game/room and round, and must not be reusable to enumerate other assets. Generate fresh tokens for each multiplayer round. The local gallery editor may show filenames because it is an authoring-only local interface.
- The UI reports broken or unsupported image files during gallery validation. The initial supported formats should be PNG, JPEG, WebP, and GIF.
- The manifest remains portable when it uses relative paths. External paths are machine-specific and should be documented as such.

### Filename tagging profile

- Each gallery may define one filename-tagging profile in its manifest because generated collections in different folders may use different naming conventions. Parse the filename stem (remove the final extension), first truncate it at the first hyphen (`-`) and ignore that hyphen plus everything after it, then split the remaining prefix on the configured delimiter. The profile maps positions to category IDs; positions are one-based after ignored tokens are removed. The sample maps five positions to its five example categories; a real gallery defines its own profile.
- Always ignore tokens consisting only of decimal digits (for example, `0001`) and tokens that exactly match `v` or `V` followed by one or more decimal digits (for example, `v1`, `V2`, `v12`). These variant/version tokens do not consume a mapped position. The exception is exact: `v1blue` and `n4` remain ordinary tokens. A numeric category value should use a non-numeric filename token/alias, such as `n3` or `three`, because numeric-only tokens are reserved for ignored variants.
- For example, `Blue_A_v1_Diamond_Rare_0001-8f3a9c.png` is first truncated to `Blue_A_v1_Diamond_Rare_0001`, split on `_`, and filtered to `Blue`, `A`, `Diamond`, `Rare`; `v1` and `0001` are ignored and do not consume positions. A gallery profile maps these four remaining positions to the appropriate category IDs. The mapping is gallery-specific; the app must not infer category meaning from token text or assume every gallery uses the same order.
- Match token values to existing values by stable ID, label, or configured alias using Unicode normalization and case-insensitive comparison. Each value may have optional `aliases`; aliases must not collide with another value in the same category. Do not silently invent categories or values from filenames. Unknown tokens are reported in preview and must be mapped to an existing value, explicitly added as a new value, or skipped before applying.
- A profile must map each active non-numeric position to exactly one category. Unmapped positions can be configured as ignored literals/metadata; duplicate category mappings, unknown category IDs, ambiguous value matches, and missing required positions are validation errors or unresolved preview items.
- A card may have multiple distinct images with identical feature assignments. Keep a separate card record and stable ID for every image; these are valid gallery variants. During game preparation, duplicate source records for a selected four-category tuple remain candidates and one is randomly selected for that game.
- Desktop imports retain the original dropped filename as `sourceName` for parsing, even if the stored asset filename is sanitized or made unique to avoid a collision. Files already in the gallery use their current filename unless an explicit source name is stored.

### Incomplete combinations report

For the four selected categories and the three selected values in each, the validator enumerates the Cartesian product and checks whether each tuple has at least one usable image. Missing tuples are shown as readable category/value labels (for example, `Hue=Red, Count=Two, Shape=Star, Texture=Dotted`). The report should group duplicate candidates separately from missing combinations and provide a total count. Category or value changes re-run validation.

When a selection is incomplete, the setup screen should help the player find a playable configuration:

- For the currently selected four categories, evaluate alternative three-value subsets for one or more categories against the usable gallery records. Recommend complete configurations first, if any exist.
- If no complete configuration exists for those categories, show the highest-coverage alternatives, ranked by the number of present combinations (81 maximum); break ties by fewer missing combinations and then stable category/value ID order.
- Recommendations should explain their coverage, such as `76/81 combinations; 5 missing`, and allow applying the suggested value choices. Show missing tuples for the applied/current selection.
- The evaluation must consider images that pass gallery validation, not merely records present in the JSON. If no combination of three values per selected category can provide full coverage, state that clearly and recommend trying different categories.
- To keep validation responsive for galleries with many categories/values, only evaluate subsets for the currently selected four categories. The implementation may cache results by gallery revision and category/value selection.

## 5. Configuration

An app-owned `config.json` stores settings independent of galleries:

```json
{
  "schemaVersion": 1,
  "targetSets": 5,
  "startingBoardSize": 12,
  "maxImageImportBytes": 26214400,
  "networkMode": "local",
  "bindAddress": "127.0.0.1",
  "publicBaseUrl": null,
  "multiplayerRoomIdleMinutes": 60,
  "popularSetupLimit": 10,
  "galleryRoots": []
}
```

- `startingBoardSize` accepts 12 or 15.
- `targetSets` accepts 1–27.
- `maxImageImportBytes` defaults to 25 MiB and limits each desktop-dropped image import.
- `networkMode` is `local` by default; multiplayer hosting must be explicitly enabled as `lan` or `hosted`.
- `bindAddress` defaults to `127.0.0.1` and changes to a network interface only when multiplayer network mode is explicitly enabled.
- `publicBaseUrl` is optional. When set, use it to construct share URLs; otherwise show detected LAN addresses and let the game master choose the address reachable by guests. Do not guess that a private LAN address is internet-accessible.
- `multiplayerRoomIdleMinutes` defaults to 60 and controls expiry of idle rooms.
- `popularSetupLimit` defaults to 10 and controls the number of popular setup templates shown before expanding the list.
- `galleryRoots` contains the explicitly configured allowlist of directory paths. Keep this list small and user-managed on disk; the UI may browse/list galleries under these roots but cannot add or change roots. Adding a gallery to the app means selecting a manifest already beneath an allowed root.
- Invalid configuration values fall back to defaults and are reported in a diagnostic message.

## 6. Screens and interactions

1. **Gallery selection:** Locally, show galleries discovered under the configured roots, validation status, the editor, and a control to rescan/register a discovered gallery. On network clients, expose only a safe list of available galleries suitable for game setup (gallery ID/name and readiness summary, no paths or file list). Provide solo-game and create-multiplayer-room entry points.
2. **Category setup:** Show all categories from the manifest, allow exactly four to be selected, then let the player choose exactly three values within each selected category. Show popular valid setup templates for the selected gallery and mode; choosing one fills the editable category/value fields. Show readiness, missing-combination diagnostics, and ranked value-selection recommendations before starting. Let the player choose a 12- or 15-card initial deal, defaulting to the configured value.
3. **Gallery editor (loopback only):** Let the local user manage a gallery's central category/value list and assign values to images using batch drag-and-drop or a file browser. Changes update that gallery's manifest. Include filename-tagging setup to choose a delimiter, map non-numeric token positions to categories, and preview parsed values before applying. Network clients must not receive editor controls or browse filesystem contents.
  - Include an explicit **Rescan Folder** action. It scans the selected gallery's configured folder for newly added supported image files, keeps existing assignments unchanged, and reports new, changed, missing, and unsupported files. For new files, run the current filename-tagging profile as a read-only preview; the user reviews and applies recognized assignments using the standard conflict/unknown-value flow.
4. **Multiplayer lobby:** Show the room URL/code and copy/share action, host-only setup controls, popular multiplayer setup templates, accepted named players, guest name/Accept controls, spectator count, and live connection status. A guest can stay in spectator mode without entering a name or accepting. Once started, freeze the roster and setup. After a round finishes, let the same host start a fresh round from this room/code, using the previous setup as editable defaults.
5. **Game screen:** In solo mode, show the selected cards, match/mistake counts, timer, remaining deck, restart, and Deal 3. In multiplayer, players see the shared board/deck/timer and each player's score, while keeping each player's in-progress selection private. Spectators see the same public state read-only and no private selections. Provide visible focus styles and keyboard-accessible card buttons.
6. **Match reward:** In solo mode, display accepted matched images in the reward lightbox at large size; support close/continue, Escape, and sensible focus handling. In multiplayer, never show this automatic lightbox. Provide a low-key, optional Trophies control that opens a non-modal gallery of Sets claimed by that player, available during or after the round without pausing play or taking focus automatically. Card images should preserve aspect ratio and include selected feature labels.
  - Every opened card lightbox includes Like, Dislike, Weird, and Interesting… controls with the current user's vote state. Voting is optional and must not interrupt play.
7. **End screen:** Solo shows win/completed outcome, elapsed time, matches, mistakes, and replay/return actions. Multiplayer shows a persistent final scoreboard and winner/tie on all clients. Only the game master can dismiss it, using **Create New Game** to begin setup for another round with the same room code; other clients remain on the result until that transition.
8. **History and statistics:** Show permanent solo and multiplayer game history, with mode filters and separate solo leaderboard versus multiplayer round/session scoreboards. Include popular and last-played setup lists derived from history. Permit local-only history clearing with explicit confirmation; multiplayer guests cannot query or clear the archive.

The visual direction should be clean and image-forward, with clear card boundaries, subtle selection emphasis, short success/removal/replacement animations, and a reduced-motion mode that disables nonessential animation.

## 7. Local API outline

- `GET /api/galleries` — loopback-only registered galleries and basic validation status; remote game clients use `/api/galleries/available` instead.
- `GET /api/galleries/available` — return only safe gallery IDs/names and readiness summaries for game setup; no disk paths, source filenames, folder listings, or unrestricted manifest data.
- `POST /api/galleries` — local-only: register/select a gallery manifest already beneath a configured allowed root and validate it; reject paths outside the allowlist.
- `POST /api/galleries/:id/validate` — local-only editor rescan/validation returning categories, counts, and file diagnostics.
- `POST /api/games` — create a game from a gallery, four category IDs, and three chosen value IDs per category; validate complete coverage, choose one candidate per tuple, shuffle, and return a game ID plus initial deal.
- `POST /api/galleries/:id/recommendations` — for four category IDs, rank three-value selections by coverage and return complete configurations where available, otherwise the best partial configurations and their missing tuples.
- `GET /api/galleries/:id/editor/files?path=...` — loopback-only: list supported image files and subfolders for the gallery editor, with paths constrained to configured roots.
- `POST /api/galleries/:id/editor/rescan` — loopback-only: rescan the selected gallery folder for supported assets, compare them with manifest records without deleting or overwriting existing metadata, and return newly discovered files plus filename-tagging preview results when a profile is configured.
- `POST /api/galleries/:id/editor/drop/preview` — loopback-only: accept a batch of image bytes and original display filenames, content-match against the selected gallery, and return `matched`, `ambiguous`, or `new` results plus proposed filename tags without changing the gallery.
- `POST /api/galleries/:id/editor/drop/apply` — loopback-only: apply the reviewed assignments; reuse matching paths/card records (creating a manifest record for an already-present but previously unregistered file), and copy only new files from staged bytes into the managed import folder. Discard staged new bytes if the batch is cancelled. Return stable gallery-relative asset IDs; never accept client filesystem paths.
- `GET/PATCH /api/galleries/:id/editor/filename-profile` — loopback-only: read or save the gallery's filename-tagging profile after validating its delimiter, positions, category IDs, and aliases.
- `POST /api/galleries/:id/editor/filename-preview` — loopback-only: parse filenames for selected known gallery assets (or all assets), returning token breakdowns, proposed assignments, unknown values, conflicts, and errors without changing files or the manifest.
- `POST /api/galleries/:id/editor/filename-apply` — loopback-only: apply user-confirmed preview assignments with per-conflict overwrite/ignore decisions, then persist the updated manifest atomically.
- `POST /api/galleries/:id/editor/assignments` — loopback-only: apply batch category/value assignments to image paths with explicit overwrite/ignore decisions; validate all IDs and paths and persist the manifest.
- `POST /api/galleries/:id/editor/categories` and `PATCH /api/galleries/:id/editor/categories/:categoryId` — loopback-only: create or rename categories.
- `POST /api/galleries/:id/editor/categories/:categoryId/values` and `PATCH /api/galleries/:id/editor/categories/:categoryId/values/:valueId` — loopback-only: create or rename values.
- `DELETE /api/galleries/:id/editor/categories/:categoryId` and `DELETE /api/galleries/:id/editor/categories/:categoryId/values/:valueId` — loopback-only: delete with explicit impact confirmation; remove the corresponding feature assignments from card records.
- `POST /api/games/:id/match` — validate a submitted triple and return match result and replacement cards when applicable.
- `POST /api/games/:id/deal` — deal three cards when permitted.
- `POST /api/games/:id/finish` — finish and persist a completed game summary.
- `GET /api/games/:gameId/assets/:opaqueToken` — serve a game-authorized image using a random opaque token mapped server-side to its validated canonical path; never accept a client-provided filesystem path or filename.
- `GET /api/history` — local-only administrative query of permanent game records with filters for mode, gallery, date range, setup, outcome, player, and game code/session.
- `DELETE /api/history` — clear permanent history only through a local-only administrative action with explicit confirmation; never available to multiplayer guests.
- `GET /api/galleries/:id/popular-setups?mode=solo|multiplayer` — derive top setup templates and start counts from history for the requested gallery/mode.
- `GET /api/galleries/:id/recent-setups?mode=solo|multiplayer` — return setups sorted/grouped by most recent start time.
- `GET /api/sessions/:sessionId` — local-only session summary containing rounds and cumulative per-player scores; do not expose cross-round private history to unauthenticated room visitors.
- `POST /api/games/:gameId/cards/:opaqueToken/vote` and `POST /api/rooms/:code/cards/:opaqueToken/vote` — create/update the current user's rating and Weird/Interesting flags for the resolved gallery card; derive username from an authenticated room participant or validated local username input, never accept a filesystem path.
- `GET /api/games/:gameId/cards/:opaqueToken/vote` and `GET /api/rooms/:code/cards/:opaqueToken/vote` — return only the requesting user's current vote state for the card.
- `GET /api/local/galleries/:id/card-feedback` — local-only editor endpoint returning aggregate per-card rating counts/net popularity and Weird/Interesting counts.
- `GET /api/local/galleries/:id/card-votes` — local-only editor endpoint returning detailed persistent votes grouped/filterable by card and username.
- `DELETE /api/local/card-votes` — local-only, explicitly confirmed clearing of persistent card votes.
- `POST /api/rooms` — create a multiplayer room and return its short code, invite URL, and creator-only host capability.
- `GET /api/rooms/:code` — return spectator-safe public room state; never include host capabilities, filesystem paths, participant reconnect secrets, or private selections.
- `POST /api/rooms/:code/join` — set or update a guest display name and accept into the waiting roster; require a valid non-empty name.
- `GET /api/rooms/:code/events` — stream public room/game changes to players and spectators using Server-Sent Events; reconnects receive a fresh public state snapshot before subsequent events. Never emit private per-player selections or capabilities.
- `PATCH /api/rooms/:code/setup` and `POST /api/rooms/:code/start` — host-capability-only setup and start operations.
- `GET /api/rooms/:code/setup-options?galleryId=...` — host-capability-only list of categories and values for a gallery in the configured catalog, plus safe coverage/diagnostics; never include filesystem paths, file listings, or image filenames. Reject gallery IDs not discovered under configured roots.
- `POST /api/rooms/:code/claim` — submit a player's three card IDs; validate participant, room state, board membership, and Set atomically.
- `GET /api/rooms/:code/trophies` — for an authenticated room participant, return only that participant's accepted Sets, including safe card/image references; spectators cannot access player-specific trophies.
- `POST /api/rooms/:code/deal` — request a Deal 3 action when the authoritative board has no Set.
- `POST /api/rooms/:code/close` — host-only early close; ordinary game completion marks the room finished and leaves it available for replay until idle expiry.
- `POST /api/rooms/:code/replay` — host-only dismissal of the final-score screen and transition from finished to waiting for another round; reset round state, retain the room code/host capability, and prefill the previous setup. Until this request succeeds, the finished result remains the active room view for all clients.

The backend owns the authoritative deck, card selection, and live game state in memory. It must validate all IDs and transitions; the browser must not be able to request arbitrary filesystem paths through image/API URLs. Resolve every served image path to its canonical real path and verify it remains under one of the configured roots before reading it. Bind only to loopback in local mode; network mode must be explicitly enabled. Keep the root allowlist in local configuration, and do not provide a remote API for adding roots. Gallery editor UI and every filesystem/manifest mutation endpoint must enforce loopback access server-side, even when the listener binds to a LAN interface. Remote game masters may select only a gallery already under configured roots and use only its existing manifest through room-scoped setup APIs; they cannot browse files, import assets, edit tags/categories, or change gallery roots. Expose to remote setup only the minimum safe gallery metadata needed for selection/validation. Write the permanent game-start record before dealing, and durably commit score/mistake updates before acknowledging them or broadcasting resulting state; derive popularity and recent-setup lists from history rather than maintaining separate counters. On process restart, mark any still-open record interrupted using its last durable counters, but do not restore its live board/deck. Use temporary-file plus atomic rename for JSON config/manifests or equivalent transactional commits for the history store. History queries and clearing are local-only administrative operations and must not be accessible to remote guests.

### Multiplayer network and security requirements

- Devices can join only if they can reach the game server. LAN mode supports devices on a reachable local network; internet play requires an intentionally hosted/reverse-proxied deployment with HTTPS and appropriate firewall/routing. A share URL must use the actual guest-reachable base URL, not `localhost` or a guessed LAN address.
- Network mode is opt-in. Show a warning that enabling LAN/hosted access exposes the multiplayer server to that network. Provide clear setup instructions and a way to return to loopback-only mode.
- Determine local-only access from the actual socket peer address (including IPv4-mapped IPv6 loopback); never trust `Host`, `Origin`, or client-supplied `X-Forwarded-For` headers as proof of localhost. A reverse proxy for hosted play must not forward the gallery-editor/admin routes to remote clients; if this cannot be guaranteed, run the editor on a separate loopback-only listener.
- Use a sufficiently high-entropy room code (at least 8 unambiguous random characters; `/game/DJGH/` is an illustrative route shape, not a recommended four-character security code), rate-limit room lookups and join attempts, and avoid leaking whether arbitrary codes exist beyond normal not-found responses.
- Keep room codes separate from host capabilities and participant reconnect tokens. Use cryptographically secure random tokens, store only what is needed, scope them to one room, and never broadcast or log secrets. Gallery/config/editor/history admin APIs are loopback-only and reject remote access even when the server is bound to a LAN interface; no password is required in the MVP because these routes are not network-accessible. Room-scoped host capabilities grant only game setup/start/replay rights and never filesystem or editor access.
- Validate request origin and use CSRF protections for state-changing endpoints. Use same-origin cookies with `HttpOnly`, `SameSite`, and `Secure` where HTTPS is available; display-name preference may be a separate non-authentication cookie.
- Server-Sent Events and ordinary HTTP POST commands are sufficient for the initial implementation and avoid a client networking plugin. State-changing actions must be serialized per room, and clients must reconcile against server snapshots after reconnect or version gaps.
- Do not expose absolute filesystem paths, source/stored filenames, or filename-derived tags in guest API responses, shared game state, or image URLs. Asset access for a multiplayer room should be limited to that round's selected cards and still pass canonical allowed-root checks. Opaque asset URLs must not reveal original filenames through redirects, error messages, response headers, or predictable token construction; use appropriate no-store/private caching for round-scoped URLs.

## 8. Non-functional requirements

- Run locally without an internet connection after dependencies are installed.
- Solo play and gallery editing remain available in local-only mode. Cross-device multiplayer works only when the server is reachable on the guests' network; it is not an external hosted service.
- Do not upload images or statistics to a remote service.
- Never serve paths outside explicitly configured gallery roots and the app's own static assets; canonicalize and enforce this for every request.
- Handle malformed manifests and missing assets without crashing; display actionable diagnostics.
- Persist configuration and permanent game history across restarts, including counters for games interrupted by shutdown; do not restore an active board/deck after restart.
- Support modern desktop browsers at common laptop and monitor sizes. Mobile layout is responsive but not a separate game mode.
- Use semantic controls, keyboard access, visible focus, and reduced-motion support.

## 9. Acceptance criteria

- A gallery can contain more than four categories; the setup screen lists all of them and requires four for play.
- A game master can create/share a multiplayer room, configure it alone, and start only after at least one named guest accepts; unaccepted or nameless visitors are excluded from the frozen roster.
- Finished multiplayer rooms can be replayed by the same game master using the same invite code until expiry; a replay resets round scores/state and allows setup edits before the next start.
- Visitors who open the room URL without accepting can spectate the lobby and active game live without a name; spectator clients are read-only and never receive private selections or credentials.
- Player-facing multiplayer game state and image URLs never reveal source filenames or filename-derived tags; round-scoped opaque asset tokens resolve only to cards in that game.
- Multiplayer matches do not open an automatic reward lightbox; players can optionally browse their own claimed Sets without pausing play.
- After a multiplayer round ends, the winner/final scoreboard stays visible to all clients until the game master chooses **Create New Game**; no guest or spectator can dismiss it.
- Multiplayer clients on different reachable devices see the same board and scores; valid Set claims are serialized so exactly one player scores for a removed Set.
- The multiplayer scoreboard tracks each participant, and multiplayer room/history data never changes solo scores, leaderboard, or solo settings.
- Started setups increment durable per-gallery popularity counts; solo and multiplayer counts are separate, popular templates can be selected then edited, and counts survive server restarts.
- Local-only is the default; enabling LAN/hosted mode is explicit, room and host secrets are separate, and the share URL contains no host capability.
- Gallery editing, browsing, importing, rescan, and metadata mutation are denied to non-loopback clients; a remote game master can still select/configure a room from existing configured galleries without receiving filesystem access or editor privileges.
- The active four categories and selected values are clearly shown before and during play; unselected category variation in the generated deck is warned about before start and explicitly does not affect Set validity.
- The gallery editor can create, rename, and delete categories/values, browse or import images, and assign a category value to individual or multiple images.
- Desktop batch drops content-match and reuse existing gallery assets/card records; only new content is imported, and repeated drops do not create renamed duplicates.
- The editor's **Rescan Folder** discovers newly added source images, leaves existing metadata intact, and offers a filename-tagging preview for new files when a profile is configured.
- Filename tagging can be configured per gallery, previewed without writes, and applied to a batch; numeric-only and exact `v`/`V` plus digits tokens are ignored, everything after the first hyphen is ignored, unknown tokens are surfaced, and duplicate feature assignments remain separate image records.
- A rematch offers Random images versus Prefer unplayed images; variant usage is remembered only during the session, while persistent votes can gently favor popular cards among equally used variants.
- Every card lightbox offers Like (+1), Dislike (-1), Weird, and Interesting… votes; a user's later vote replaces their prior vote for that card, aggregates appear in the local gallery editor, and multiplayer clients cannot inspect one another's individual votes or popularity during play.
- Existing differing assignments trigger explicit overwrite/ignore/cancel review; successful edits update the manifest safely, and destructive metadata changes explain their impact.
- A valid selection includes exactly four categories and three chosen values per category, produces exactly 81 cards with unique selected-category/value tuples, and chooses randomly among duplicate source records.
- An incomplete selection cannot start, displays every missing tuple, and provides ranked alternative value choices (or clearly says none of the evaluated choices is complete).
- Set validation implements the all-same-or-all-different rule independently across the four categories.
- The player can start with 12 or 15 cards, find Sets, add three when needed, see match animation and reward lightbox, and restart.
- Win/loss completion follows the configured target and exhaustion rules.
- Every started game appears in permanent local history with its status, times/duration, setup, scores, and mistakes after app restart; interrupted games are marked as such and no active board/deck is restored.
- Gallery paths are constrained to the manually configured root allowlist and the service is bound to localhost.

## 10. Gallery authoring requirements

The editor operates on one selected gallery and its manifest, which is the authoritative central list of categories and values for that folder. It does not move, rename, or modify existing source image files. Desktop drag-and-drop is a convenient way to select batches in the operating system's file explorer; it updates assignments for matching existing assets and imports only files that are not already present.

### Browse and batch assignment

- Provide an in-app folder browser rooted at the selected gallery folder and constrained to the configured gallery roots. It may recursively list supported image formats and folders; it must not expose arbitrary filesystem paths. Images selected in this browser can be dragged into the assignment area by their server-known gallery-relative IDs.
- Accept batches of image files dropped from the desktop/file explorer. The browser does not provide a trustworthy absolute path, so send file bytes and the display filename only; never accept or use a client-supplied local path. First preview the batch without modifying the gallery. For each dropped file, compute a cryptographic content digest and compare it with all supported files already in the selected gallery, including files not yet registered in the manifest (verify bytes on a digest match where practical). If exactly one existing path has identical bytes, reuse that path and existing card record, or create a manifest record pointing to that existing file if it was not registered; do not copy or create a renamed duplicate. If identical bytes match multiple existing paths/records, mark the drop ambiguous and ask the user which existing record(s) to target before applying. Matching is by content, not filename alone, so a different image reusing the same filename is treated as new content.
- Only after the user reviews and applies the batch are genuinely new image bytes copied (never moved or modified at the source) into a managed subfolder such as `assets/imported/` inside the selected gallery—not into the app install or a game/session folder. Discard staged bytes on cancel or short expiry; staged data must be loopback-only, size-limited, and cleaned up after apply/cancel/expiry. Validate supported type and configurable size, sanitize the stored name, and resolve name collisions without overwriting an existing file (for example, append a numeric suffix). Preserve the dropped original filename as `sourceName` for filename tagging. Register the imported image and apply the selected tag through the same reviewed assignment flow. Re-dropping the same existing image in later batches must find and reuse its asset record.
- Show image thumbnails, filenames, current assignments, and whether the image has no card record, partial assignments, or all currently defined categories assigned. Unassigned files can be discovered by rescanning the gallery folder; creating a card record is part of its first assignment.
- The user selects a category and one of that category's values, then drops or selects one or more images from the OS file explorer or in-app browser. Apply the chosen value to that category for each resolved existing or newly imported image. Repeated desktop drops of the same file update the existing card's feature assignment, not create new copies/records. An image may have assignments for many categories, but at most one value per category.
- If a target image already has a different value for the chosen category, show a conflict review before saving. For each conflict, allow **Overwrite**, **Ignore**, or **Cancel**; provide bulk overwrite/ignore controls for batches. Ignore preserves the existing value. Assigning the already-present value is a no-op. Non-conflicting assignments in the same batch may be applied only after the user confirms the batch review.
- Support assigning values image-by-image from the folder browser as well as batch drag-and-drop. Include search/filter by filename, assignment state, category, and value, plus pagination or virtualized rendering for large folders.
- Show clear success/error feedback and refresh assignment indicators immediately after a successful save. A failed save must not leave the UI claiming changes were persisted.

### Filename-based tagging

- Provide profile setup controls for the delimiter (underscore by default) and a mapping from each remaining token position to a category in this gallery. Always strip the extension, ignore the first hyphen and everything after it, then ignore numeric-only and `v`/`V` plus digits tokens before mapping positions. Include a sample filename/token preview that visibly marks ignored suffix/tokens so the user can verify positions before saving the profile.
- Run a dry-run preview over selected images or all supported images in the gallery. Show each filename, the truncated pre-hyphen stem, split tokens, ignored suffix and ignored numeric/`vN` tokens, proposed category/value assignments, unknown values, ambiguous matches, and conflicts with existing assignments. Preview is read-only.
- Numeric-only tokens such as `0001` and exact `v`/`V` plus digits tokens such as `v1` are always skipped and do not identify separate feature values. Everything after the first hyphen in the filename stem is ignored. Non-numeric tokens such as `n4` are parsed normally. Distinct files with the same parsed values remain distinct image/card records and count as duplicate candidates, not errors.
- Resolve unknown tokens by mapping them to an existing value, explicitly creating a value in the appropriate category, or skipping that assignment. Never silently create categories or values. If token positions are missing, shifted, duplicated, or ambiguous, flag the file and do not apply its unresolved assignments.
- Applying a preview uses the same conflict rules as manual tagging: overwrite, ignore, or cancel. By default, do not overwrite existing assignments automatically. Applying is idempotent: rerunning the same profile on unchanged files creates no duplicate card records and does not alter already-equal assignments.
- Store original filenames for desktop-imported assets so generated storage names and collision suffixes do not change the parse result. For files already in the gallery, parse the actual filename unless an explicit source name is present.

### Category and value management

- Allow creating, renaming, and deleting categories and values. Names must be non-empty; IDs are generated as stable internal identifiers and are not changed when a label is renamed.
- A category/value rename updates its display label without rewriting image feature IDs. Deleting a value removes that assignment from all affected cards; deleting a category removes that feature from all cards. Before either destructive action, show how many images/assignments will be affected and require confirmation.
- Categories with fewer than three values and incomplete image tagging are valid while editing, but cannot be selected for a game until their chosen value triple has complete 81-combination coverage.
- Editing a gallery in use by an active game does not mutate that game's in-memory deck. A later game or validation uses the latest saved manifest.

### Manifest durability and validation

- Persist successful edits to `set-gallery.json` using write-to-temporary-file then atomic rename. Keep a last-known-good backup before replacing the manifest and offer recovery if the manifest becomes invalid. The editor should warn before destructive operations and provide an undo for the most recent in-session edit when practical.
- Serialize concurrent manifest writes and detect if the manifest changed externally since it was loaded; on conflict, reload or offer a safe merge instead of silently overwriting external edits.
- The editor exposes a deliberate **Rescan Folder** button; no file-system watcher is required. Rescanning discovers new supported images without deleting or changing existing card metadata. When a filename profile is configured, parse newly discovered files into a reviewable preview; do not silently apply tags. The user explicitly applies recognized assignments, while unknowns and conflicts follow the existing resolution flow. Missing files remain in the manifest and are reported as broken references rather than silently removed.
- A card record may have partial or no feature assignments during authoring. The `features` object contains only assigned category IDs; game readiness validation checks completeness for the four selected categories. The editor may omit card records for images never assigned, but should still display discovered unassigned files.

## 11. Deferred features

- Native OS folder picker or desktop packaging.
- Gameplay undo, multiple rule variants, and sound. (The editor's limited in-session undo is separate.)
- More or fewer than four categories in an active game, or more or fewer than three selected values per active category. Galleries may define any number of categories and any number of values (including fewer than three during authoring), but a standard game uses four categories and a chosen triple of values from each.
