import {del, list, put} from '@vercel/blob';

/**
 * Shared classroom state. Steady state: ONE stable blob per room
 * (`gwis/<room>/state.json`), overwritten on every write and fetched
 * directly on every read -- zero list calls, nothing accumulates.
 *
 * Set GWIS_BLOB_BASE_URL in Vercel to the store's public base URL
 * (dashboard -> Storage -> gwis-state, e.g.
 * https://<store-id>.public.blob.vercel-storage.com). When it is unset,
 * the endpoint falls back to the legacy path: unique keys per write +
 * list() to find the newest. The browser client is unchanged either way.
 *
 * Uses named GET/POST exports (Web fetch-style), as required for api/ routes.
 */

const ROOM_RE = /^[\w-]{1,32}$/;
const STABLE_NAME = 'state.json';

type Snapshot = {
  at: number;
  session: string;
  origin: 'teacher' | 'glasses';
  state: unknown;
};

function roomOf(value: unknown): string | null {
  return typeof value === 'string' && ROOM_RE.test(value) ? value : null;
}

function queryOf(req: Request): URL {
  // In the serverless runtime req.url may be only the path/query.
  return new URL(req.url, 'http://localhost');
}

/** Public base URL of the Blob store, or null when not configured. */
function blobBase(): string | null {
  const v = process.env.GWIS_BLOB_BASE_URL?.trim().replace(/\/+$/, '');
  return v ? v : null;
}

const stableKey = (room: string) => `gwis/${room}/${STABLE_NAME}`;
const stableUrl = (room: string) => `${blobBase()}/${stableKey(room)}`;

/** Read the stable snapshot directly; null when absent or unreadable. */
async function readStable(room: string): Promise<Snapshot | null> {
  const res = await fetch(stableUrl(room), {cache: 'no-store'});
  if (!res.ok) return null;
  try {
    const snap = (await res.json()) as Snapshot;
    return snap && typeof snap.at === 'number' ? snap : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: {room?: unknown; snapshot?: unknown};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({error: 'bad json'}, {status: 400});
  }
  const room = roomOf(body.room);
  const snap = body.snapshot as Snapshot | undefined;
  if (!room || !snap || typeof snap.at !== 'number' || !snap.state) {
    return Response.json({error: 'bad request'}, {status: 400});
  }

  if (blobBase()) {
    // Stable-key path: never overwrite a newer snapshot with an older one.
    const current = await readStable(room);
    if (current && current.at > snap.at) {
      return Response.json({ok: true, stale: true});
    }
    await put(stableKey(room), JSON.stringify(snap), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
      cacheControlMaxAge: 0,
    });
    // Best-effort orphan cleanup: remove pre-stable-key blobs so nothing
    // accumulates. Self-terminating -- after the first pass only the
    // stable key remains.
    try {
      const {blobs} = await list({prefix: `gwis/${room}/`});
      const orphans = blobs
        .map(b => b.url)
        .filter(u => !u.endsWith(`/${STABLE_NAME}`));
      if (orphans.length) await del(orphans);
    } catch {
      /* orphan cleanup is optional */
    }
    return Response.json({ok: true});
  }

  // Legacy fallback (GWIS_BLOB_BASE_URL unset): unique key per write.
  const key =
    `gwis/${room}/${snap.at}-` + `${Math.random().toString(36).slice(2, 8)}.json`;
  await put(key, JSON.stringify(snap), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  });
  return Response.json({ok: true});
}

export async function GET(req: Request): Promise<Response> {
  const url = queryOf(req);
  const room = roomOf(url.searchParams.get('room'));
  if (!room) return Response.json({error: 'bad room'}, {status: 400});
  const since = Number(url.searchParams.get('since') || 0);

  if (blobBase()) {
    const snap = await readStable(room);
    if (!snap || !(snap.at > since)) return new Response(null, {status: 204});
    return Response.json({snapshot: snap, at: snap.at});
  }

  // Legacy fallback: find the newest blob under the room prefix.
  const {blobs} = await list({prefix: `gwis/${room}/`});
  const fresh = blobs
    .map(b => ({b, at: Date.parse(b.uploadedAt)}))
    .filter(x => Number.isFinite(x.at) && x.at > since)
    .sort((a, b) => b.at - a.at)[0];
  if (!fresh) return new Response(null, {status: 204});
  const res = await fetch(fresh.b.url, {cache: 'no-store'});
  if (!res.ok) return new Response(null, {status: 502});
  const snapshot = (await res.json()) as Snapshot;
  return Response.json({snapshot, at: fresh.at});
}
