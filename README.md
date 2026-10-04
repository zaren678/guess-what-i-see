# Guess What I See

A classroom guessing game for LDS Primary (built for CTR 6, 7-year-olds): one
kid wears **Ray-Ban Meta Display glasses** and sees a secret word, describes
it without saying it, and the class guesses. The teacher drives the whole
round from a laptop.

- **Glasses** (`/`) — a pure display: "Waiting for teacher…" when idle, then
  just the secret word + category during a round. No buttons; voice commands
  ("Hey Meta, we got it" / "skip this one" / "start the round") work as a
  backup via WebMCP.
- **Teacher console** (`/teacher`) — the mission control: full clue card
  (word, don't-say words, hint), color-coded "Team X describes" turn banner,
  round controls, scoreboard, projector mode. Keyboard shortcuts: `G` got it,
  `S` skip, `Space` start/pause, `N`/`P` next/previous clue.
- **Sync** — the glasses and laptop link with no relay server: both sides
  POST/GET state snapshots through `api/state.ts`, backed by a Vercel Blob
  store. Each room owns one stable blob (`gwis/<room>/state.json`) that every
  write overwrites and reads fetch directly — zero `list()` calls in steady
  state and nothing accumulates. Direct reads need the `GWIS_BLOB_BASE_URL`
  env var on the Vercel project (the store's public base URL: dashboard →
  Storage → `gwis-state`, e.g. `https://<store-id>.public.blob.vercel-storage.com`,
  no trailing slash) — set on the Vercel project (production + preview);
  when unset, reads fall back to listing for the newest blob. Both sides
  poll every 2.5s. Malformed snapshots are rejected at the boundary, and
  broadcasts retry with backoff until the server confirms. Both screens show
  the room code (they must match to link), and the teacher console warns
  while any move is unconfirmed. Starting is a handshake: the teacher's
  Start holds the clock in `starting` until the glasses echoes the start
  nonce (or the teacher presses Start again to begin anyway). One-shot
  celebrations and warnings on the glasses go out as toasts, not inline
  rows, so the word and don't-say list stay on screen.

## Decks

Clue decks live in `decks/` as JSON (see `decks/README.md` for the format).
`old-testament-heroes.json` and `primary-favorites.json` are bundled.

## Develop

```bash
npm install
npm run dev        # glasses + console, local (cloud link dormant on localhost)
./scripts/gate.sh  # Meta wearables gate for the glasses experience
```

The gate judges the glasses routes only (`/`, `/deck/*`). The teacher
console (`/teacher/*`) is a laptop page (plain HTML/CSS, no UI Toolkit) and is
stubbed out of the gate copy — see `scripts/gate.sh` for the two documented
exemptions.

## Deploy

Vercel, framework Vite, build `npm run build`, output `dist`. Connect a Blob
store named `gwis-state` to the project so `api/state.ts` has its token.

Live: https://guess-what-i-see.vercel.app

Deployments are automatic: the Vercel project is linked to this repo, so
every push to `main` builds and publishes a new production version.
Pushes to other branches get preview URLs instead.
