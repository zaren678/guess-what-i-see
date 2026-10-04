import {dispatchGame, getGameState, subscribeGameState} from './store';
import {isTickOnly, type GameState} from './state';

/**
 * Cloud link between the glasses web app and the teacher console.
 *
 * The deployment is static, so shared state lives behind a tiny same-origin
 * API (api/state.ts) backed by the project's Blob store: every discrete
 * local game mutation is POSTed as a full state snapshot, and each side polls
 * for newer snapshots every few seconds. Last-writer-wins by wall-clock
 * mutation time; the 1-second TICK is never broadcast (each side ticks
 * locally from the last synced snapshot). When the API is unreachable both
 * sides keep working standalone -- the link badge simply reads Offline.
 *
 * Room defaults to "primary" so Sunday just works with zero setup.
 * Override with ?room=<code> (persisted to localStorage) for a private room.
 */

const ROOM_KEY = 'gwis.room';
const DEFAULT_ROOM = 'primary';
/**
 * Poll cadence, running or idle alike. Reads are cheap direct fetches of one
 * small key (no billable list calls since the stable-key change), so an idle
 * tab sipping every 2.5s costs essentially nothing -- and the describer never
 * stares at a stale screen for 10s after the teacher hits Start.
 */
const POLL_MS = 2500;
const STALE_MS = 8000;
/** Snapshots older than this are never a live game; ignore on first sight. */
const MAX_SNAPSHOT_AGE = 2 * 60 * 60 * 1000;
/**
 * The link needs the same-origin /api/state function, which only exists on
 * the deployed site (local `vite preview` serves static files only), so the
 * cloud stays dormant on loopback and the app runs standalone there.
 */
/** Hostnames where the same-origin /api/state function cannot exist, so the
 *  cloud link stays dormant instead of spamming a failing endpoint. The API
 *  only exists on the deployed site; loopback, LAN, and .local hosts are all
 *  local dev/preview. */
export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) return true;
  if (host === '0.0.0.0' || host.endsWith('.local')) return true;
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

function cloudAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return !isLocalHostname(window.location.hostname);
}

export type CloudRole = 'teacher' | 'glasses';

export function resolveRoom(): string {
  if (typeof window === 'undefined') return DEFAULT_ROOM;
  try {
    const param = new URLSearchParams(window.location.search).get('room');
    if (param && /^[\w-]{1,32}$/.test(param)) {
      window.localStorage.setItem(ROOM_KEY, param);
      return param;
    }
    const stored = window.localStorage.getItem(ROOM_KEY);
    if (stored && /^[\w-]{1,32}$/.test(stored)) return stored;
  } catch {
    /* storage unavailable: fall through to default */
  }
  return DEFAULT_ROOM;
}

type Snapshot = {connected: boolean; room: string; synced: boolean};
let snapshot: Snapshot = {connected: false, room: DEFAULT_ROOM, synced: true};
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach(l => l());
}
export function subscribeCloud(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function getCloudSnapshot(): Snapshot {
  return snapshot;
}
function setConnected(value: boolean) {
  if (snapshot.connected !== value) {
    snapshot = {...snapshot, connected: value};
    emit();
  }
}

function setSynced(value: boolean) {
  if (snapshot.synced !== value) {
    snapshot = {...snapshot, synced: value};
    emit();
  }
}

type WirePayload = {
  at: number;
  session: string;
  origin: CloudRole;
  state: GameState;
};

const sessionId = Math.random().toString(36).slice(2, 10);
let attachedRole: CloudRole | null = null;
let attachedRoom: string | null = null;
let cleanup: (() => void) | null = null;
let pollTimer: number | null = null;
let lastAt = 0;
let lastAdoptedAt = 0;
let lastPollOkAt = 0;
let applyingRemote = false;
let prevState: GameState | null = null;
/** Monotonic id so a delayed broadcast retry never overwrites a newer move. */
let broadcastSeq = 0;

/**
 * POST one snapshot, retrying with backoff until the server confirms or a
 * newer local move supersedes it. A lost write used to die silently (one
 * retry, no signal) while the teacher saw the move applied locally -- now
 * every send tracks server confirmation and the teacher console warns while
 * any move is unconfirmed.
 */
const BROADCAST_RETRIES = 4;
function broadcast(state: GameState, room: string, role: CloudRole) {
  const seq = ++broadcastSeq;
  const body = JSON.stringify({
    room,
    snapshot: {
      at: Date.now(),
      session: sessionId,
      origin: role,
      state,
    } satisfies WirePayload,
  });
  let attempt = 0;
  const send = () => {
    if (seq !== broadcastSeq || typeof window === 'undefined') return;
    attempt += 1;
    fetch('/api/state', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body,
    })
      .then(res => {
        if (seq !== broadcastSeq) return;
        if (!res.ok) throw new Error(`http ${res.status}`);
        setSynced(true);
      })
      .catch(() => {
        if (seq !== broadcastSeq) return;
        setSynced(false);
        if (attempt <= BROADCAST_RETRIES) {
          window.setTimeout(() => {
            if (seq === broadcastSeq) send();
          }, 1000 * attempt);
        }
      });
  };
  send();
}

function adopt(
  payload: WirePayload,
  onRemoteState: (state: GameState) => void,
) {
  if (payload.session === sessionId) return;
  if (payload.at <= lastAdoptedAt) return;
  lastAdoptedAt = payload.at;
  const s = payload.state;
  const adjusted: GameState =
    s.phase === 'running'
      ? {
          ...s,
          remainingSeconds: Math.max(
            0,
            s.remainingSeconds - Math.floor((Date.now() - payload.at) / 1000),
          ),
        }
      : s;
  applyingRemote = true;
  try {
    onRemoteState(adjusted);
  } finally {
    applyingRemote = false;
  }
}

async function pollOnce(
  room: string,
  onRemoteState: (state: GameState) => void,
) {
  try {
    const res = await fetch(
      `/api/state?room=${encodeURIComponent(room)}&since=${lastAt}`,
      {cache: 'no-store'},
    );
    if (res.status === 204) {
      lastPollOkAt = Date.now();
      setConnected(true);
      return;
    }
    if (!res.ok) throw new Error(`http ${res.status}`);
    const data = (await res.json()) as {
      snapshot?: WirePayload;
      at?: number;
    };
    lastPollOkAt = Date.now();
    setConnected(true);
    if (data.at) lastAt = Math.max(lastAt, data.at);
    if (data.snapshot && typeof data.snapshot.at === 'number') {
      adopt(data.snapshot, onRemoteState);
    }
  } catch {
    if (Date.now() - lastPollOkAt > STALE_MS) setConnected(false);
  }
}

function stopPolling() {
  if (pollTimer !== null) {
    window.clearTimeout(pollTimer);
    pollTimer = null;
  }
  setConnected(false);
}

function startPolling(
  room: string,
  onRemoteState: (state: GameState) => void,
) {
  stopPolling();
  const tick = () => {
    if (pollTimer === null) return;
    void pollOnce(room, onRemoteState).finally(() => {
      if (pollTimer !== null) {
        pollTimer = window.setTimeout(tick, POLL_MS);
      }
    });
  };
  pollTimer = window.setTimeout(tick, 0);
}

export function attachCloud(opts: {
  role: CloudRole;
  onRemoteState: (state: GameState) => void;
}) {
  if (typeof window === 'undefined') return;
  const room = resolveRoom();
  if (attachedRole === opts.role && attachedRoom === room) return;
  // Role or ?room= changed (e.g. the teacher pasted a new room code):
  // tear down the old link before attaching the new one.
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  attachedRole = opts.role;
  attachedRoom = room;
  snapshot = {connected: false, room, synced: true};
  if (!cloudAvailable()) return;
  prevState = getGameState();
  lastAdoptedAt = Date.now() - MAX_SNAPSHOT_AGE;
  const {role, onRemoteState} = opts;

  const unsubStore = subscribeGameState(() => {
    const next = getGameState();
    const prev = prevState;
    prevState = next;
    // Start handshake. The glasses echoes an unacked start nonce and sends
    // it immediately; the teacher begins the clock once the echo arrives.
    // These run ahead of the applyingRemote guard on purpose: the ack and
    // the begin are new moves the other side must receive.
    if (
      role === 'glasses' &&
      next.phase === 'starting' &&
      next.startId !== '' &&
      next.ackedId !== next.startId
    ) {
      const sent = broadcastSeq;
      dispatchGame({type: 'SET_ACKED', ackedId: next.startId});
      // A local transition already broadcast via the nested subscriber pass;
      // only send explicitly when it ran under a remote apply (suppressed).
      if (broadcastSeq === sent) broadcast(getGameState(), room, role);
      return;
    }
    if (
      role === 'teacher' &&
      next.phase === 'starting' &&
      next.startId !== '' &&
      next.ackedId === next.startId
    ) {
      const sent = broadcastSeq;
      dispatchGame({type: 'BEGIN_ROUND'});
      if (broadcastSeq === sent) broadcast(getGameState(), room, role);
      return;
    }
    if (!prev || applyingRemote) return;
    if (isTickOnly(prev, next)) return;
    broadcast(next, room, role);
  });

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') stopPolling();
    else startPolling(room, onRemoteState);
  };
  document.addEventListener('visibilitychange', onVisibility);

  cleanup = () => {
    unsubStore();
    document.removeEventListener('visibilitychange', onVisibility);
    stopPolling();
    attachedRole = null;
    attachedRoom = null;
  };

  startPolling(room, onRemoteState);
}
