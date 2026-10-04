import {before, test} from 'node:test';
import assert from 'node:assert/strict';

/**
 * Handshake tests for the start protocol in src/game/cloud.ts: the glasses
 * echoes an unacked start nonce exactly once, and the teacher begins the
 * clock exactly once when the echo arrives. Both flows run through the real
 * poll/adopt path with a scripted server, so these pin the no-double-post
 * invariant, not just the reducer.
 */

type Timer = {id: number; fn: () => void; ms: number};
const timers: Timer[] = [];
let timerId = 0;
const fetchCalls: {url: unknown; method: unknown; body: string}[] = [];
let nextGet: {snapshot: unknown; at: number} | null = null;

(globalThis as any).window = {
  setTimeout: (fn: () => void, ms: number) => {
    const id = ++timerId;
    timers.push({id, fn, ms});
    return id;
  },
  clearTimeout: (id: number) => {
    const i = timers.findIndex(t => t.id === id);
    if (i >= 0) timers.splice(i, 1);
  },
  // The round clock (store.ts) uses intervals; they stay parked unless a
  // test drains them, so TICKs never fire spontaneously mid-suite.
  setInterval: (fn: () => void) => {
    const id = ++timerId;
    timers.push({id, fn, ms: -1});
    return id;
  },
  clearInterval: (id: number) => {
    const i = timers.findIndex(t => t.id === id);
    if (i >= 0) timers.splice(i, 1);
  },
  location: {hostname: 'example.com', search: ''},
};
(globalThis as any).document = {
  visibilityState: 'visible',
  addEventListener: () => {},
  removeEventListener: () => {},
};
(globalThis as any).fetch = async (url: unknown, opts: any) => {
  fetchCalls.push({url, method: opts?.method, body: String(opts?.body ?? '')});
  if (opts?.method === 'POST') return {ok: true, status: 200};
  if (nextGet) {
    return {ok: true, status: 200, json: async () => nextGet};
  }
  return {ok: true, status: 204};
};

function postsSince(n: number) {
  return fetchCalls.slice(n).filter(c => c.method === 'POST');
}

async function flush() {
  await new Promise(r => setImmediate(r));
}

/**
 * Run the oldest pending timer, then flush promises. Polls chain (each poll
 * schedules the next), so FIFO order replays the same sequence the browser
 * would run, minus the waiting.
 */
async function runPoll() {
  // Poll ticks only (ms >= 0); parked clock intervals (ms -1) never run.
  const i = timers.findIndex(t => t.ms >= 0);
  assert.notEqual(i, -1, 'expected a scheduled poll');
  const [t] = timers.splice(i, 1);
  t.fn();
  await flush();
}

function postedState(call: {body: string}) {
  return (JSON.parse(call.body) as {snapshot: {state: any}}).snapshot.state;
}

// Imports hoist above the stubs; attachCloud runs in before(), after setup.
import {attachCloud} from '../src/game/cloud';
import {dispatchGame} from '../src/game/store';
import {
  initialGameState,
  isGameState,
  type GameState,
} from '../src/game/state';

/** The page-owned half of sync (mirrors useGame): validated remote snapshots
 *  replace local state. attachCloud only transports; without this, adoption
 *  would never reach the store. */
function applyRemote(remote: GameState) {
  if (isGameState(remote)) {
    dispatchGame({type: 'APPLY_STATE', state: remote});
  }
}

function startingState(overrides: Partial<GameState>): GameState {
  return {
    ...initialGameState,
    deckId: 'd',
    order: [0],
    phase: 'starting',
    remainingSeconds: 60,
    startId: 'n1',
    ackedId: '',
    ...overrides,
  };
}

const base = Date.now();

before(() => {
  dispatchGame({type: 'APPLY_STATE', state: initialGameState});
  attachCloud({role: 'glasses', onRemoteState: applyRemote});
});

test('glasses echoes an unacked start exactly once', async () => {
  const at = base + 1000;
  nextGet = {
    at,
    snapshot: {
      at,
      session: 'remote-teacher',
      origin: 'teacher',
      state: startingState({}),
    },
  };
  const n = fetchCalls.length;
  await runPoll();

  const posts = postsSince(n);
  assert.equal(posts.length, 1);
  const state = postedState(posts[0]);
  assert.equal(state.phase, 'starting');
  assert.equal(state.ackedId, 'n1');
});

test('glasses stays quiet once the start is acked', async () => {
  const at = base + 2000;
  nextGet = {
    at,
    snapshot: {
      at,
      session: 'remote-teacher',
      origin: 'teacher',
      state: startingState({ackedId: 'n1'}),
    },
  };
  const n = fetchCalls.length;
  await runPoll();
  assert.equal(postsSince(n).length, 0);
});

test('teacher waits for the echo, then begins exactly once', async () => {
  attachCloud({role: 'teacher', onRemoteState: applyRemote});

  const at = base + 3000;
  nextGet = {
    at,
    snapshot: {
      at,
      session: 'remote-glasses',
      origin: 'glasses',
      state: startingState({startId: 'n2'}),
    },
  };
  let n = fetchCalls.length;
  await runPoll();
  assert.equal(postsSince(n).length, 0);

  const atAck = base + 4000;
  nextGet = {
    at: atAck,
    snapshot: {
      at: atAck,
      session: 'remote-glasses',
      origin: 'glasses',
      state: startingState({startId: 'n2', ackedId: 'n2'}),
    },
  };
  n = fetchCalls.length;
  await runPoll();

  const posts = postsSince(n);
  assert.equal(posts.length, 1);
  const state = postedState(posts[0]);
  assert.equal(state.phase, 'running');
  assert.equal(state.remainingSeconds, 60);
  assert.equal(state.clueIndex, 0);
});

test("teacher's own start reaches the server", async () => {
  const n = fetchCalls.length;
  dispatchGame({
    type: 'APPLY_STATE',
    state: startingState({startId: 'n3'}),
  });
  await flush();

  const posts = postsSince(n);
  assert.equal(posts.length, 1);
  assert.equal(postedState(posts[0]).phase, 'starting');
});
