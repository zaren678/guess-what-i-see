import {list, put} from '@vercel/blob';

/**
 * Tiny shared state for the classroom link. The glasses app and the teacher
 * console both talk to this endpoint. Each room owns ONE stable blob key
 * (`gwis/<room>/state.json`) that every write overwrites, and reads fetch
 * that key directly -- so steady-state sync costs zero `list` calls (Blob
 * `list` is a billable advanced operation) and old snapshots never pile up.
 * No secrets ever reach the browser -- the BLOB_READ_WRITE_TOKEN env var
 * lives only in this function.
 *
 * Direct fetch needs the store's public base URL, configured once as
 * GWIS_BLOB_BASE_URL (e.g. https://<store>.public.blob.vercel-storage.com).
 * When it is unset, GET falls back to the legacy list-newest path so the app
 * keeps working (at advanced-op cost).
 *
 * Uses named GET/POST exports (Web fetch-style), as required for api/ routes.
 */

const ROOM_RE = /^[\w-]{1,32}$/;
/** Snapshots are ~1KB of JSON; anything larger is not our game state. */
const MAX_SNAPSHOT_BYTES = 131072;

type Snapshot = {
  at: number;
  session: string;
  origin: 'teacher' | 'glasses';
  state: unknown;
};

function roomOf(value: unknown): string | null {
  return typeof value === 'string' && ROOM_RE.test(value) ? value : null;
}

/** Cheap wire-shape check. Full GameState validation lives client-side
 *  (isGameState in src/game/state.ts); this just rejects garbage early. */
function isSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.at === 'number' &&
    Number.isFinite(s.at) &&
    typeof s.session === 'string' &&
    s.session.length >= 1 &&
    s.session.length <= 64 &&
    (s.origin === 'teacher' || s.origin === 'glasses') &&
    typeof s.state === 'object' &&
    s.state !== null
  );
}

function baseUrl(req: Request): URL {
  // In the serverless runtime req.url may be only the path/query.
  return new URL(req.url, 'http://localhost');
}

function keyOf(room: string): string {
  return `gwis/${room}/state.json`;
}

/** Public base URL of the connected Blob store, without trailing slash. */
function blobBase(): string | null {
  const raw = process.env.GWIS_BLOB_BASE_URL;
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  return /^https:\/\//.test(trimmed) ? trimmed : null;
}

export async function POST(req: Request): Promise<Response> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    return Response.json({error: 'bad body'}, {status: 400});
  }
  if (text.length > MAX_SNAPSHOT_BYTES) {
    return Response.json({error: 'snapshot too large'}, {status: 413});
  }
  let body: {room?: unknown; snapshot?: unknown};
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return Response.json({error: 'bad json'}, {status: 400});
  }
  const room = roomOf(body.room);
  const snap = body.snapshot;
  if (!room || !isSnapshot(snap)) {
    return Response.json({error: 'bad request'}, {status: 400});
  }
  await put(keyOf(room), JSON.stringify(snap), {
    access: 'public',
    addRandomSuffix: false,
    // Overwriting the stable key requires this; without it the first write
    // succeeds and every later write throws.
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  });
  return Response.json({ok: true, at: snap.at});
}

export async function GET(req: Request): Promise<Response> {
  const url = baseUrl(req);
  const room = roomOf(url.searchParams.get('room'));
  if (!room) return Response.json({error: 'bad room'}, {status: 400});
  const since = Number(url.searchParams.get('since') || 0);
  const base = blobBase();
  if (!base) return legacyGet(room, since);
  const res = await fetch(`${base}/${keyOf(room)}`, {cache: 'no-store'});
  if (res.status === 404) return new Response(null, {status: 204});
  if (!res.ok) return new Response(null, {status: 502});
  let snapshot: unknown;
  try {
    snapshot = (await res.json()) as unknown;
  } catch {
    return new Response(null, {status: 502});
  }
  if (!isSnapshot(snapshot)) return new Response(null, {status: 502});
  if (Number.isFinite(since) && !(snapshot.at > since)) {
    return new Response(null, {status: 204});
  }
  return Response.json({snapshot, at: snapshot.at});
}

/**
 * Fallback when GWIS_BLOB_BASE_URL is unset: list the room prefix and fetch
 * the newest blob. Correct, but every poll costs an advanced `list`
 * operation and one blob per write piles up -- set the env var instead.
 */
async function legacyGet(room: string, since: number): Promise<Response> {
  const {blobs} = await list({prefix: `gwis/${room}/`});
  const fresh = blobs
    .map(b => ({
      b,
      at:
        b.uploadedAt instanceof Date
          ? b.uploadedAt.getTime()
          : Date.parse(b.uploadedAt),
    }))
    .filter(x => Number.isFinite(x.at) && x.at > since)
    .sort((a, b) => b.at - a.at)[0];
  if (!fresh) return new Response(null, {status: 204});
  const res = await fetch(fresh.b.url, {cache: 'no-store'});
  if (!res.ok) return new Response(null, {status: 502});
  const snapshot = (await res.json()) as Snapshot;
  return Response.json({snapshot, at: fresh.at});
}
