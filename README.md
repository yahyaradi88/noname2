# NO NAME

A real multiplayer deduction and memory card game for 2–8 friends. React and TypeScript render the table; a persistent Node.js / Socket.IO service owns the game. No account is needed.

## Run it

Install **Node.js 24 or later** and run these commands from this directory:

```sh
npm install
cp .env.example .env
npm run dev
```

On Windows, use `Copy-Item .env.example .env` instead of `cp`. Open **http://localhost:3000**. Create a room in one browser and join from a different browser or an incognito window. Tabs in the same browser profile deliberately share a seat through an HttpOnly cookie. To test on another device, set `ORIGIN` to the exact reachable origin (for example `http://192.168.1.20:3000`) and open that same origin on both devices. Allow the chosen port through your firewall if needed.

The development command compiles the server and serves the client with Vite HMR. After editing server source, restart `npm run dev`, or run `npx tsc -p tsconfig.server.json --watch` in a second terminal so the running Node watcher reloads compiled changes.

If your environment restricts native development dependency scanning, use the compiled local preview:

```sh
npm run build
# POSIX
SERVE_BUILD=1 npm start
# PowerShell
$env:SERVE_BUILD='1'; npm start
```

`SERVE_BUILD` selects compiled client assets; it does not disable production security. This local preview uses HTTP only when `NODE_ENV` is not `production`.

## Rules

Every player receives exactly four cards from a cryptographically shuffled 52-card deck. Initial completed ranks are laid down immediately. The first player is randomly chosen; play proceeds clockwise.

On your turn, choose another player and ask about a rank in your active hand. The server immediately announces whether the rank is correct. A correct rank unlocks the quantity question (1–3). A correct exact quantity is announced to everyone and unlocks the suit question. Guess exactly that many distinct suits to take the cards and earn another turn with a fresh timer. Successful transfers keep granting turns until you miss, time out, or the game ends. An incorrect answer at any stage draws one card if available and immediately ends the turn. Correct rank/quantity answers do not draw or rotate. Four suits of a rank automatically become a public set worth one point. The log displays only the latest question: who asked whom, what they asked, and whether it was correct.

An empty hand draws one card at the beginning of its turn. With an empty pile, empty hands are skipped. Timer expiry ends the turn without a penalty draw. All 13 ranks completed ends the game, as does an empty pile with no remaining interaction. Highest set count wins; equal highest scores share the win.

Disconnected seats are reserved for **five minutes**, including with the timer off. A disconnected player remains targetable during the grace period. Leaving or exceeding the grace period forfeits the player, securely reshuffles their active hand into the pile, and preserves their completed ranks publicly while excluding them from winner eligibility. Fewer than two non-forfeited players ends the game. After the host forfeits, the earliest connected remaining player becomes host. Ready status is informational, and the host can start once at least two players are connected. These choices implement the supplied brief's recommended rules.

## Architecture and information boundaries

```
apps/web/src/          React UI, local selections, card graphics, sound
apps/server/           networking, cookie sessions, validation, rooms, persistence
packages/game-engine/ authoritative engine, secure shuffle, per-player sanitization
packages/shared/      shared TypeScript types and socket contracts
migrations/           SQLite schema initialization/version
tests/                engine, room, complete-game and live-network checks
```

The client sends intentions, never replacement state. The server serializes room operations, validates commands with Zod, changes the engine state, commits the snapshot, and sends a **separate sanitized view to every session**. Opponents have card counts and completed ranks, never a `hand` field. Deck order, session identifiers, password hashes and failure details never enter the client view. Successful transfers are intentionally public; drawn card faces appear only in the receiving hand.

The engine uses explicit server stages: `LOBBY → DEALING → WAITING_FOR_TURN → WAITING_FOR_AMOUNT → WAITING_FOR_SUITS → RESOLVING_GUESS → CHECKING_SETS → TURN_END`, with `GAME_OVER` terminal until the host resets. Successful rank and quantity answers are intentionally public under the revised rules. Wrong answers reveal only that the submitted answer failed, never the actual quantity or suits. Confirmed questions are locked; clients cannot revise earlier stages. Pending questions survive reconnection. The timer covers the entire turn and is not reset between stages. If the selected opponent forfeits mid-question, the same player may select another opponent within the existing deadline. Amount/suit options derive only from the viewer's own hand and are revalidated on the server.

### Socket contract

All commands use `command(payload, ack)`; acknowledgements are `{ ok: true }` or `{ ok: false, error: string }`. See `packages/shared/types.ts` for the typed union and `apps/server/validation.ts` for runtime validation.

| Client command | Required fields                                      | Authorization                                               |
| -------------- | ---------------------------------------------------- | ----------------------------------------------------------- |
| `create`       | name, roomName, maxPlayers, timer, privacy, password | valid session without a seat                                |
| `join`         | name, code, password                                 | available lobby and correct password                        |
| `ready`        | none                                                 | seated lobby player                                         |
| `start`        | none                                                 | host, at least two connected players                        |
| `askRank`      | actionId, turnId, targetId, rank                     | current player, rank stage                                  |
| `askAmount`    | actionId, turnId, amount                             | same player, quantity stage                                 |
| `askSuits`     | actionId, turnId, suits                              | same player, suits stage                                    |
| `settings`     | maxPlayers, timer, optional password                 | lobby host; omitted password preserves it, empty removes it |
| `kick`         | playerId                                             | lobby host                                                  |
| `leave`        | none                                                 | seated player                                               |
| `reset`        | none                                                 | host after game over                                        |

Server events: `state(view | null)` replaces the local view; `notice(message)` explains seat removal or other room notices. Socket.IO reconnects with the same cookie. Guess UUIDs are idempotent over a bounded recent-action history, and turn UUIDs reject stale commands even after that history expires. Client submission is locked synchronously before sending.

### Database

This implementation intentionally uses **SQLite WAL**, rather than requiring external PostgreSQL/Redis, for an independently deployable single-instance service. Node's built-in SQLite driver applies `migrations/001_initial.sql` automatically. No separate database installation is required.

`rooms` stores an authoritative JSON aggregate with game/player state and the last 80 public audit events. A single atomic snapshot keeps cards, scores and turns consistent. `sessions` stores SHA-256 digests of 256-bit bearer secrets with seven-day expiry. `schema_migrations` records the applied version. Snapshots are loaded after process restart and seats enter the reconnect grace period. State is persisted after every mutation; expired sessions and abandoned rooms are cleaned up.

The database is private server data, including hands and decks. Restrict file permissions, use encrypted persistent storage and protected backups, and never serve the data directory. This is a **single Node process** architecture: do not run multiple replicas against separate copies of the database. Horizontal scaling requires a shared transactional store plus room ownership/locking and a Socket.IO adapter; it is not implemented here. The retained audit history is bounded, not an indefinite dispute archive.

### Security and randomness

- Fisher–Yates uses `node:crypto.randomInt()` at every step. Room codes and the starting seat also use cryptographic randomness. Production has no seeded-deck or debug-state endpoint.
- Passwords use bcrypt at cost 12. Passwords are bounded to bcrypt's 72-byte input limit before hashing. Neither passwords nor hashes are logged or broadcast.
- Session cookies are HttpOnly, SameSite=Strict, and Secure in production. Only hashes are stored. Identity comes from the cookie, never a player ID submitted by the client.
- Exact origin checks apply to session creation and WebSocket handshakes. Helmet adds security headers; production enforces a restrictive CSP. All assets are local.
- Join/create attempts are limited by session and IP; actions and connections are bounded. Zod rejects unknown fields, invalid names, impossible amounts, duplicate suits and malformed identifiers. React escapes displayed text. Database queries are parameterized.
- Forged turns, self-targets, nonexistent ranks, own-suit guesses and expired turns are rejected before mutation. Public failures do not include actual opponent counts or suits.
- For internet deployment, place the service behind HTTPS/WSS, a trusted proxy and edge request limits. No claim of an independent security audit or load qualification is made.

## Configuration

| Variable        | Default                 | Purpose                                       |
| --------------- | ----------------------- | --------------------------------------------- |
| `PORT`          | `3000`                  | HTTP/WebSocket listening port                 |
| `HOST`          | `0.0.0.0`               | bind address                                  |
| `ORIGIN`        | `http://localhost:3000` | exact public origin, no trailing slash        |
| `DATABASE_PATH` | `./data/no-name.sqlite` | persistent SQLite file                        |
| `NODE_ENV`      | development             | set `production` for deployment               |
| `TRUST_PROXY`   | unset                   | set `1` only behind one trusted reverse proxy |
| `SERVE_BUILD`   | unset                   | serve built client for local preview          |

The `.env` file is optional and never committed. Production refuses to start without an HTTPS `ORIGIN`.

## Validation

```sh
npm test
npm run lint
npm run build
# In another terminal, while the app is running:
node tests/network.integration.mjs
```

Engine tests cover unique decks, deals for 2–8 players, information boundaries, all guess quantities, wrong ranks, self-targeting, suit validation, transfers, failed draws, set completion, empty-hand rules, timer semantics, replay rejection, forfeits, ties, and ending. Full-game simulations assert card conservation until all 13 ranks complete. Room tests cover passwords, capacity, host settings, session restoration from storage, schema validation and rate limiting. The live integration test opens genuinely separate cookie sessions through Socket.IO and checks synchronization, origin rejection, private payloads, actions, disconnect/reconnect, forfeiture and reset. `TEST_ORIGIN` can point it at another non-production test server. It creates and cleans up a test room.

`npm run format` applies Prettier. The checked-in pnpm lockfile provides reproducible dependency resolution; you may use `pnpm install --frozen-lockfile` instead of npm. No AI players, spectator mode, public room directory, chat or account system are included. Public/private is stored and displayed; both currently join by code, and private rooms have no directory listing.

## Deployment

Deploy a **persistent container**, such as a Render service, Railway service, Fly machine or your own server. A standard Vercel request handler cannot own these long-lived sockets.

1. Build the included Dockerfile or run `npm run build` on a Node 24 service.
2. Set `NODE_ENV=production`, `ORIGIN=https://your-domain.example`, and `DATABASE_PATH=/data/no-name.sqlite`.
3. Mount a persistent volume at `/data`, writable by the container's Node user (UID 1000).
4. Forward HTTP and WebSocket upgrades to port 3000 and enable HTTPS at the proxy. Set `TRUST_PROXY=1` only if that proxy is trusted and is the sole hop.
5. Run exactly one replica. Use `/health` for readiness. Back up SQLite with its online backup API or a consistent database/volume snapshot; copying just the main file while WAL writes are active is unsafe.
6. Allow graceful SIGTERM shutdown. Test reconnection and restore a backup before inviting real players.

The app is provided as a runnable, deployment-configured source project. It has not been published to an external host, stress tested, or independently penetration tested.
#   L i a r  
 