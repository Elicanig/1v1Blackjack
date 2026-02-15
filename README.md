# Blackjack Battle

A playable 1v1 real-time web app that blends blackjack actions with head-to-head pressure betting.

## Stack
- Node.js + Express
- Socket.IO (authoritative real-time server)
- Postgres (Neon via `DATABASE_URL`) persistence for accounts/profiles/friends/lobbies/challenges
- In-memory match engine/state (reconnect grace window supported)
- Vanilla SPA frontend (mobile + desktop)

## Run
1. Install dependencies:
   - `npm install`
2. Start server:
   - `npm start`
3. Open:
   - `http://127.0.0.1:3000`

## Included Features
- Register/login with unique usernames
- Profiles (avatar, bio, chips, stats)
- Friends system
  - Add by username
  - Friend invite link generation + accept flow
- Lobby flow
  - Create private 1v1 lobby
  - Shareable lobby link
  - Join lobby by code/link
- Real-time Blackjack Battle match
  - Initial visible/hidden cards
  - Alternating first action per round
  - Actions: Hit, Stand, Double, Split, Surrender
  - Split up to 3 times (max 4 hands)
  - Pressure betting on split/double (opponent match-or-surrender)
  - Bust handling and per-hand settlement
- Play vs Bot mode
  - Difficulties: easy, medium, normal
  - Higher difficulty applies stronger action/pressure accuracy
  - Clicking bot difficulty auto-creates a private bot practice lobby and starts the match (no manual key entry)
- Daily reward claim
- Challenge progression + claiming
- Reconnect support with 60s disconnect grace
- Strict authoritative phase flow:
  - `LOBBY -> ROUND_INIT -> ACTION_TURN -> PRESSURE_RESPONSE -> HAND_ADVANCE -> ROUND_RESOLVE -> NEXT_ROUND`

## Test
- Run `npm test` for rule/state transition coverage.

## Notes
- Match state is authoritative and server-side in memory.
- Persistent entities (users/friends/lobbies/challenges) use Postgres when `DATABASE_URL` is set.
- In production, `DATABASE_URL` is required (server fails fast if missing).
- Local fallback:
  - If `DATABASE_URL` is missing in non-production, the app falls back to `./data/db.json` for dev/test convenience.
- Render setup:
  - Set `DATABASE_URL=<your-neon-connection-string>`.
  - Set `SESSION_SECRET=<long-random-string>` (or `JWT_SECRET`).
  - Optional local/dev-only override: `DATA_DIR=./data`.
  - On boot, storage logs include:
    - `Using Postgres storage via DATABASE_URL` (Postgres mode)
    - `Loaded X users from Postgres`
    - or JSON fallback logs for local dev mode
- For production scale, replace in-memory match storage with Redis and add hardened auth/session handling.
