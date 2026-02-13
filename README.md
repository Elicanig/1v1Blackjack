# Blackjack Battle

A playable 1v1 real-time web app that blends blackjack actions with head-to-head pressure betting.

## Stack
- Node.js + Express
- Socket.IO (authoritative real-time server)
- LowDB JSON persistence for accounts/profiles/friends/lobbies/challenges
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
- Run `npm test` for rule/state transition coverage (28 cases).

## Notes
- Match state is authoritative and server-side in memory.
- Persistent entities (users/friends/lobbies/challenges) are in `db.json` under `DATA_DIR` (defaults to `/var/data`).
- Render deployment:
  - Mount a persistent disk to `/var/data` (or set `DATA_DIR` to your mount path).
  - Set `SESSION_SECRET` (or `JWT_SECRET`) as an environment variable so auth tokens remain stable across deploys.
- For production scale, replace in-memory match storage with Redis and add hardened auth/session handling.
