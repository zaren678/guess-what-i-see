import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  gameReducer,
  initialGameState,
  isGameState,
  isTickOnly,
  type GameState,
} from '../src/game/state';
import {ROUND_SECONDS} from '../src/domain';

function running(overrides: Partial<GameState> = {}): GameState {
  return {
    ...initialGameState,
    deckId: 'd',
    order: [2, 0, 1],
    phase: 'running',
    remainingSeconds: 42,
    ...overrides,
  };
}

test('SELECT_DECK loads the deck and resets the round', () => {
  const next = gameReducer(
    {...initialGameState, scoreA: 3, currentTeam: 'B'},
    {type: 'SELECT_DECK', deckId: 'heroes', order: [1, 0]},
  );
  assert.equal(next.deckId, 'heroes');
  assert.deepEqual(next.order, [1, 0]);
  assert.equal(next.phase, 'idle');
  assert.equal(next.scoreA, 0);
  assert.equal(next.currentTeam, 'A');
});

test('START_ROUND needs a non-empty incoming order', () => {
  const ok = gameReducer(initialGameState, {
    type: 'START_ROUND',
    order: [0, 1],
  });
  assert.equal(ok.phase, 'running');
  assert.equal(ok.clueIndex, 0);
  assert.equal(ok.remainingSeconds, ROUND_SECONDS);

  // Guards the action's order, not the stale state's.
  const seeded = running({order: [0]});
  const noop = gameReducer(seeded, {type: 'START_ROUND', order: []});
  assert.strictEqual(noop, seeded);
});

test('CORRECT scores the describing team and advances', () => {
  const next = gameReducer(running({currentTeam: 'B', clueIndex: 0}), {
    type: 'CORRECT',
  });
  assert.equal(next.scoreB, 1);
  assert.equal(next.scoreA, 0);
  assert.equal(next.clueIndex, 1);

  const idle = gameReducer(initialGameState, {type: 'CORRECT'});
  assert.strictEqual(idle, initialGameState);
});

test('SKIP advances only while running, wrapping at the end', () => {
  const next = gameReducer(running({clueIndex: 2}), {type: 'SKIP'});
  assert.equal(next.clueIndex, 0);

  const paused = gameReducer(running({phase: 'paused'}), {type: 'SKIP'});
  assert.equal(paused.clueIndex, 0);
  assert.equal(paused.scoreA, 0);
});

test('GOTO wraps positive and negative indices', () => {
  const s = running();
  assert.equal(gameReducer(s, {type: 'GOTO', index: 3}).clueIndex, 0);
  assert.equal(gameReducer(s, {type: 'GOTO', index: -1}).clueIndex, 2);
  assert.equal(gameReducer(s, {type: 'GOTO', index: 1}).clueIndex, 1);
  assert.strictEqual(gameReducer(initialGameState, {type: 'GOTO', index: 2}), initialGameState);
});

test('TICK counts down and completes at zero', () => {
  assert.equal(
    gameReducer(running({remainingSeconds: 10}), {type: 'TICK'}).remainingSeconds,
    9,
  );
  const done = gameReducer(running({remainingSeconds: 1}), {type: 'TICK'});
  assert.equal(done.remainingSeconds, 0);
  assert.equal(done.phase, 'complete');

  const paused = gameReducer(running({phase: 'paused'}), {type: 'TICK'});
  assert.strictEqual(paused.phase, 'paused');
});

test('END_ROUND / RESET_ROUND lifecycle', () => {
  const ended = gameReducer(running(), {type: 'END_ROUND'});
  assert.equal(ended.phase, 'complete');
  assert.equal(ended.remainingSeconds, 0);
  assert.strictEqual(gameReducer(initialGameState, {type: 'END_ROUND'}), initialGameState);

  const reset = gameReducer(
    {...running(), phase: 'complete', scoreA: 4, currentTeam: 'B', revealed: true},
    {type: 'RESET_ROUND'},
  );
  assert.equal(reset.phase, 'idle');
  assert.equal(reset.scoreA, 0);
  assert.equal(reset.currentTeam, 'A');
  assert.equal(reset.revealed, false);
  assert.equal(reset.remainingSeconds, ROUND_SECONDS);
});

test('POINT clamps at zero; SWITCH_TEAM toggles; SET_REVEALED sets', () => {
  const s = running();
  assert.equal(gameReducer(s, {type: 'POINT', team: 'A', delta: 1}).scoreA, 1);
  assert.equal(gameReducer(s, {type: 'POINT', team: 'A', delta: -1}).scoreA, 0);
  assert.equal(gameReducer(s, {type: 'POINT', team: 'B', delta: -1}).scoreB, 0);
  assert.equal(gameReducer(s, {type: 'SWITCH_TEAM'}).currentTeam, 'B');
  assert.equal(gameReducer(s, {type: 'SET_REVEALED', revealed: true}).revealed, true);
});

test('APPLY_STATE replaces wholesale', () => {
  const custom = running({scoreA: 9});
  assert.strictEqual(gameReducer(initialGameState, {type: 'APPLY_STATE', state: custom}), custom);
});

test('isGameState accepts good snapshots and rejects junk', () => {
  assert.equal(isGameState(initialGameState), true);
  assert.equal(isGameState(running()), true);
  for (const bad of [
    null,
    undefined,
    42,
    'state',
    {},
    {...running(), phase: 'overtime'},
    {...running(), currentTeam: 'C'},
    {...running(), deckId: 5},
    {...running(), order: [0, -1]},
    {...running(), order: [0, 1.5]},
    {...running(), clueIndex: -1},
    {...running(), remainingSeconds: NaN},
    {...running(), scoreA: Infinity},
    {...running(), revealed: 'yes'},
  ]) {
    assert.equal(isGameState(bad), false);
  }
});

test('isTickOnly spots the 1-second clock and nothing else', () => {
  const prev = running({remainingSeconds: 30});
  assert.equal(isTickOnly(prev, {...prev, remainingSeconds: 29}), true);
  assert.equal(isTickOnly(prev, {...prev, remainingSeconds: 28}), false);
  assert.equal(isTickOnly(prev, {...prev, scoreA: 1, remainingSeconds: 29}), false);
  assert.equal(
    isTickOnly(prev, {...prev, phase: 'paused', remainingSeconds: 29}),
    false,
  );
  assert.equal(
    isTickOnly(prev, {...prev, order: [...prev.order], remainingSeconds: 29}),
    false,
  );
});
