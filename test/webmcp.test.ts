import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  describeGame,
  EMPTY_SCHEMA,
  ok,
  problem,
  safeRegister,
  snapshotOf,
  type ModelContext,
  type Snapshot,
} from '../src/webmcp';
import {initialGameState} from '../src/game/state';

test('snapshotOf degrades cleanly with no deck loaded', () => {
  const snap = snapshotOf(initialGameState);
  assert.equal(snap.deckTitle, null);
  assert.equal(snap.clueNumber, null);
  assert.equal(snap.totalClues, 0);
  assert.equal(snap.word, null);
  assert.deepEqual(snap.forbiddenWords, []);
  assert.equal(snap.phase, 'idle');
  assert.equal(snap.scoreA, 0);
});

test('describeGame narrates a full snapshot', () => {
  const snap: Snapshot = {
    deckTitle: 'Heroes',
    clueNumber: 2,
    totalClues: 12,
    word: 'Noah',
    category: 'Person',
    forbiddenWords: ['ark', 'flood'],
    hint: 'Boat.',
    phase: 'running',
    remainingSeconds: 37,
    scoreA: 3,
    scoreB: 2,
    currentTeam: 'A',
  };
  const text = describeGame(snap);
  assert.match(text, /Noah/);
  assert.match(text, /clue 2 of 12/);
  assert.match(text, /ark, flood/);
  assert.match(text, /Team A 3, Team B 2/);
});

test('ok and problem serialize tool results', () => {
  assert.deepEqual(JSON.parse(ok({next: 'stop'}) as string), {next: 'stop'});
  const err = JSON.parse(problem('nope', 'retry') as string) as {
    error: boolean;
  };
  assert.equal(err.error, true);
});

test('EMPTY_SCHEMA is an empty object schema', () => {
  assert.deepEqual(EMPTY_SCHEMA, {type: 'object', properties: {}, required: []});
});

test('safeRegister registers and never throws', () => {
  const seen: string[] = [];
  const ctx: ModelContext = {
    registerTool: tool => {
      seen.push(tool.name);
      return undefined;
    },
  };
  safeRegister(ctx, {
    name: 'demo',
    description: 'demo',
    inputSchema: EMPTY_SCHEMA,
    execute: () => ok({}),
  });
  assert.deepEqual(seen, ['demo']);

  let errors = 0;
  const origError = console.error;
  console.error = () => {
    errors += 1;
  };
  try {
    safeRegister(
      {
        registerTool: () => {
          throw new Error('nope');
        },
      },
      {
        name: 'broken',
        description: 'broken',
        inputSchema: EMPTY_SCHEMA,
        execute: () => ok({}),
      },
    );
  } finally {
    console.error = origError;
  }
  assert.equal(errors, 1);
});
