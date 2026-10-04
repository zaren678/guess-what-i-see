# Guess What I See

A classroom guessing game for LDS Primary (built for CTR 6, 7-year-olds): one
kid wears **Ray-Ban Meta Display glasses** and sees a secret word, describes
it without saying it, and the class guesses. The teacher drives the whole
round from a laptop.

- **Glasses** (`/`) — a pure display: a "You're the describer!" role card
  when idle, then countdown + team banner, the secret word with its
  don't-say words and hint, clue progress, and got-it/skip celebration
  banners with a streak meter during a round. No buttons; voice commands
  ("Hey Meta, we got it" / "skip this one" / "start the round") work as a
  backup via WebMCP.
- **Teacher console** (`/teacher`) — the mission control: full clue card
  (word, don't-say words, hint), color-coded "Team X describes" turn banner,
  round controls, scoreboard, projector mode. Keyboard shortcuts: `G` got it,
  `S` skip, `Space` start/pause, `N`/`P` next/previous clue.
- **Sync** — the glasses and laptop link with no relay server: both sides
  POST/GET state snapshots through `api/state.ts`, backed by a Vercel Blob
  store (one stable `gwis/<room>/state.json` key per room, overwritten per
  write, newest wins). Polling is 2.5s while a round runs, 10s otherwise;
  malformed snapshots are rejected at the boundary, and broadcasts retry
  once before giving up to standalone mode.

## Decks

Clue decks live in `decks/` as JSON (see `decks/README.md` for the format).
`old-testament-heroes.json` and `primary-favorites.json` are bundled.

## Develop

```bash
npm install
npm test           # unit suite: stdlib node:test, no framework to install
npm run dev        # glasses + console, local (cloud link dormant on localhost/LAN)
./scripts/gate.sh  # Meta wearables gate for the glasses experience
```

The gate judges the glasses routes only (`/`, `/deck/*`). The teacher
console (`/teacher/*`) is a laptop page (plain HTML/CSS, no UI Toolkit) and is
stubbed out of the gate copy — see `scripts/gate.sh` for the two documented
exemptions.

## Deploy

Vercel, framework Vite, build `npm run build`, output `dist`. Connect a Blob
store named `gwis-state` to the project so `api/state.ts` has its token,
and add a `GWIS_BLOB_BASE_URL` env var with the store's public base URL
(e.g. `https://<store>.public.blob.vercel-storage.com`). Reads fetch the
room key directly off that URL, which is what keeps steady-state sync off
the billable advanced-operations meter (`list` calls). Without the env var
the API falls back to list-newest reads.

One-time cleanup: rooms written before the stable-key change left one blob
per move under `gwis/`. Delete those old keys in the dashboard
(Storage → `gwis-state`) to reclaim the space; new writes overwrite in
place and accumulate nothing.

Live: https://guess-what-i-see.vercel.app

Deployments are automatic: the Vercel project is linked to this repo, so
every push to `main` builds and publishes a new production version.
Pushes to other branches get preview URLs instead.
