import type {GameState} from './state';
import {dispatchGame, getGameState, subscribeGameState} from './store';

export type RelayRole = 'glasses' | 'teacher';

export type RelayCommand = {
  action:
    | 'start'
    | 'pause'
    | 'resume'
    | 'correct'
    | 'skip'
    | 'end'
    | 'goto'
    | 'reset'
    | 'pointA'
    | 'pointB'
    | 'unpointA'
    | 'unpointB'
    | 'switchTeam'
    | 'reveal'
    | 'hide';
  index?: number;
};

type WireMessage =
  | {type: 'hello'; role: RelayRole; clientId: string}
  | {type: 'state'; state: GameState}
  | {type: 'command'; command: RelayCommand};

export type BusCallbacks = {
  role: RelayRole;
  onRemoteState: (state: GameState) => void;
  onRemoteCommand: (command: RelayCommand) => void;
};

const STORAGE_KEY = 'gwis.relayUrl';

function isValidRelayUrl(value: string | null): value is string {
  return !!value && (value.startsWith('ws://') || value.startsWith('wss://'));
}

/** Resolve the relay URL: `?relay=` wins and is persisted, else localStorage. */
export function resolveRelayUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const param = new URLSearchParams(window.location.search).get('relay');
    if (isValidRelayUrl(param)) {
      window.localStorage.setItem(STORAGE_KEY, param);
      return param;
    }
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isValidRelayUrl(stored) ? stored : null;
  } catch {
    return null;
  }
}

// ---- Module-level singleton bus: one socket per page load, shared by every
// ---- page so navigation never drops the teacher link.

type BusSnapshot = {connected: boolean; url: string | null};

let busUrl: string | null = null;
let busConnected = false;
let socket: WebSocket | null = null;
let retryTimer: number | null = null;
let attempt = 0;
let generation = 0;
let callbacks: BusCallbacks | null = null;
let storeUnsubscribe: (() => void) | null = null;
const busListeners = new Set<() => void>();
const clientId = `bus-${Math.random().toString(36).slice(2, 10)}`;

function emitBus(): void {
  busListeners.forEach(listener => listener());
}

export function subscribeBus(listener: () => void): () => void {
  busListeners.add(listener);
  return () => {
    busListeners.delete(listener);
  };
}

// Cached: useSyncExternalStore requires a stable snapshot identity or it
// re-renders in a loop.
let busSnapshotCache: BusSnapshot | null = null;

export function getBusSnapshot(): BusSnapshot {
  const cache = busSnapshotCache;
  if (
    !cache ||
    cache.connected !== busConnected ||
    cache.url !== busUrl
  ) {
    busSnapshotCache = {connected: busConnected, url: busUrl};
  }
  return busSnapshotCache as BusSnapshot;
}

function setConnected(value: boolean): void {
  if (busConnected !== value) {
    busConnected = value;
    emitBus();
  }
}

function send(message: WireMessage): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(message));
  } catch {
    /* unreachable relay: views stay standalone */
  }
}

export function broadcastState(state: GameState): void {
  send({type: 'state', state});
}

export function sendCommand(command: RelayCommand): void {
  send({type: 'command', command});
}

function clearRetry(): void {
  if (retryTimer !== null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function teardown(): void {
  clearRetry();
  const current = socket;
  socket = null;
  if (current) {
    try {
      current.close();
    } catch {
      /* already closed */
    }
  }
}

function scheduleRetry(): void {
  const gen = generation;
  if (document.visibilityState !== 'visible') return;
  attempt += 1;
  const delay = Math.min(1000 * 2 ** Math.min(attempt, 3), 8000);
  clearRetry();
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    if (gen === generation) connect();
  }, delay);
}

function connect(): void {
  const gen = generation;
  const url = busUrl;
  if (!url) return;
  let next: WebSocket;
  try {
    next = new WebSocket(url);
  } catch {
    scheduleRetry();
    return;
  }
  socket = next;
  const role = callbacks?.role ?? 'glasses';
  next.onopen = () => {
    if (gen !== generation) return;
    attempt = 0;
    setConnected(true);
    send({type: 'hello', role, clientId});
  };
  next.onmessage = event => {
    if (gen !== generation) return;
    let message: WireMessage | null = null;
    try {
      message = JSON.parse(String(event.data)) as WireMessage;
    } catch {
      return;
    }
    const cb = callbacks;
    if (!cb) return;
    if (cb.role === 'glasses' && message.type === 'state') {
      cb.onRemoteState(message.state);
    } else if (cb.role === 'teacher' && message.type === 'command') {
      cb.onRemoteCommand(message.command);
    }
  };
  next.onerror = () => {
    /* handled: onclose follows and schedules the retry */
  };
  next.onclose = () => {
    if (socket === next) socket = null;
    setConnected(false);
    scheduleRetry();
  };
}

/**
 * Attach a page to the shared bus. The socket outlives page navigation;
 * callbacks always point at the currently mounted page.
 */
export function attachBus(cb: BusCallbacks): void {
  callbacks = cb;
  if (typeof window === 'undefined') return;
  if (!busUrl) {
    const url = resolveRelayUrl();
    if (!url) return;
    busUrl = url;
    emitBus();
  }
  if (!storeUnsubscribe) {
    // The teacher console is the authority: every state change is pushed so
    // linked glasses stay in lockstep.
    storeUnsubscribe = subscribeGameState(() => {
      if (callbacks?.role === 'teacher' && socket) {
        broadcastState(getGameState());
      }
    });
  }
  if (!socket) {
    generation += 1;
    attempt = 0;
    connect();
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      teardown();
      setConnected(false);
    } else if (busUrl && !socket) {
      generation += 1;
      attempt = 0;
      connect();
    }
  });
}
