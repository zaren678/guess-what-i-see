import {list, put} from '@vercel/blob';

/**
 * Tiny shared state for the classroom link. The glasses app and the teacher
 * console both talk to this endpoint; the Blob store holds one JSON snapshot
 * per write under a unique key, and reads always fetch the newest key, so
 * there is no stale-cache hazard. No secrets ever reach the browser -- the
 * BLOB_READ_WRITE_TOKEN env var lives only in this function.
 *
 * Uses named GET/POST exports (Web fetch-style), as required for api/ routes.
 */

const ROOM_RE = /^[\w-]{1,32}$/;

type Snapshot = {
  at: number;
  session: string;
  origin: 'teacher' | 'glasses';
  state: unknown;
};

function roomOf(value: unknown): string | null {
  return typeof value === 'string' && ROOM_RE.test(value) ? value : null;
}

function baseUrl(req: Request): URL {
  // In the serverless runtime req.url may be only the path/query.
  return new URL(req.url, 'http://localhost');
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
  const url = baseUrl(req);
  const room = roomOf(url.searchParams.get('room'));
  if (!room) return Response.json({error: 'bad room'}, {status: 400});
  const since = Number(url.searchParams.get('since') || 0);
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
