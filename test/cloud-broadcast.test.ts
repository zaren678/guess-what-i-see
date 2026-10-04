import {before, test} from 'node:test';
import assert from 'node:assert/strict';

/**
 * Regression tests for the acked-broadcast path in src/game/cloud.ts: every
 * local move must reach the server (retried with backoff until confirmed),
 * stale retries must never fire after a newer move, and the teacher console's
 * sync flag must reflect reality.
 *
 * The module is browser-shaped, so the suite stubs the three browser
 * surfaces it touches (window timers/location, document visibility, fetch)
 * and drives time manually -- no real waiting, fully deterministic.
 */

type Timer = {id: number; fn: () => void; ms: number};
const timers: Timer[] = [];
let timerId = 0;
/** Retry delays actually scheduled (poll ticks use 0/2500, never these). */
const retryDelays: number[] = [];
const fetchCalls: {url: unknown; method: unknown; body: string}[] = [];
let postBehavior: 'ok' | 'fail' | 'http500' = 'ok';

(globalThis as any).window = {
  setTimeout: (fn: () => void, ms: number) => {
    const id = ++timerId;
    timers.push({id, fn, ms});
    if (ms >= 1000 && ms <= 4000) retryDelays.push(ms);
    return id;
  },
  clearTimeout: (id: number) => {
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
  if (opts?.method === 'POST') {
    if (postBehavior === 'fail') throw new Error('network down');
    if (postBehavior === 'http500') return {ok: false, status: 500};
    return {ok: true, status: 200};
  }
  return {ok: true, status: 204};
};

function postsSince(n: number) {
  return fetchCalls.slice(n).filter(c => c.method === 'POST');
}

/** Run pending retry timers in schedule order, flushing promises between. */
async function drainRetries() {
  for (const ms of [1000, 2000, 3000, 4000]) {
    const i = timers.findIndex(t => t.ms === ms);
    if (i >= 0) {
      const [t] = timers.splice(i, 1);
      t.fn();
      await new Promise(r => setImmediate(r));
    }
  }
}

async function flush() {
  await new Promise(r => setImmediate(r));
}

// Imports hoist above the stubs, which is fine: nothing touches the browser
// until attachCloud runs inside before().
import {attachCloud, getCloudSnapshot} from '../src/game/cloud';
import {dispatchGame} from '../src/game/store';
import {initialGameState} from '../src/game/state';

before(() => {
  dispatchGame({type: 'APPLY_STATE', state: initialGameState});
  attachCloud({role: 'teacher', onRemoteState: () => {}});
});

test('broadcasts local mutations and marks them synced', async () => {
  postBehavior = 'ok';
  const base = fetchCalls.length;
  dispatchGame({type: 'POINT', team: 'A', delta: 1});
  await flush();

  const posts = postsSince(base);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/api/state');
  const payload = JSON.parse(posts[0].body) as {
    room: string;
    snapshot: {origin: string; session: string; at: number; state: {scoreA: number}};
  };
  assert.equal(payload.room, 'primary');
  assert.equal(payload.snapshot.origin, 'teacher');
  assert.equal(typeof payload.snapshot.session, 'string');
  assert.equal(payload.snapshot.state.scoreA, 1);
  assert.equal(getCloudSnapshot().synced, true);
});

test('retries unacked sends with backoff, then stops', async () => {
  postBehavior = 'fail';
  retryDelays.length = 0;
  const base = fetchCalls.length;
  dispatchGame({type: 'POINT', team: 'B', delta: 1});
  await flush();

  assert.equal(postsSince(base).length, 1);
  assert.equal(getCloudSnapshot().synced, false);

  await drainRetries();
  assert.deepEqual(retryDelays, [1000, 2000, 3000, 4000]);
  assert.equal(postsSince(base).length, 5);

  // Exhausted: running the queue again sends nothing more.
  await drainRetries();
  assert.equal(postsSince(base).length, 5);
  assert.equal(getCloudSnapshot().synced, false);
});

test('a newer move supersedes a failing send', async () => {
  postBehavior = 'fail';
  const base = fetchCalls.length;
  dispatchGame({type: 'POINT', team: 'A', delta: 1});
  await flush();
  assert.equal(postsSince(base).length, 1);

  // Newer move acks immediately; the older retry timer must go quiet.
  postBehavior = 'ok';
  dispatchGame({type: 'POINT', team: 'A', delta: 1});
  await flush();
  assert.equal(postsSince(base).length, 2);
  assert.equal(getCloudSnapshot().synced, true);

  await drainRetries();
  assert.equal(postsSince(base).length, 2);
});

test('non-OK responses count as unacked and recover on ack', async () => {
  postBehavior = 'http500';
  const base = fetchCalls.length;
  dispatchGame({type: 'POINT', team: 'B', delta: 1});
  await flush();
  assert.equal(postsSince(base).length, 1);
  assert.equal(getCloudSnapshot().synced, false);

  postBehavior = 'ok';
  await drainRetries();
  assert.ok(postsSince(base).length > 1);
  assert.equal(getCloudSnapshot().synced, true);
});
