import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPublicAction,
  commandToPublicAction,
  toRelayCommand,
  type PublicAction,
} from '../src/game/actions';
import {dispatchGame, getGameState} from '../src/game/store';
import {initialGameState} from '../src/game/state';

const roundTrip: PublicAction[] = [
  {type: 'start'},
  {type: 'pause'},
  {type: 'resume'},
  {type: 'correct'},
  {type: 'skip'},
  {type: 'end'},
  {type: 'reset'},
  {type: 'pointA'},
  {type: 'pointB'},
  {type: 'unpointA'},
  {type: 'unpointB'},
  {type: 'switchTeam'},
  {type: 'reveal'},
  {type: 'hide'},
];

test('toRelayCommand maps every public action, goto keeps its index', () => {
  for (const action of roundTrip) {
    const cmd = toRelayCommand(action);
    assert.ok(cmd, `maps ${action.type}`);
    assert.equal(cmd.action, action.type);
  }
  assert.deepEqual(toRelayCommand({type: 'goto', index: 4}), {
    action: 'goto',
    index: 4,
  });
  // Deck selection is state-only; it never travels the relay.
  assert.equal(toRelayCommand({type: 'selectDeck', deckId: 'x'}), null);
});

test('commandToPublicAction inverts the mapping and rejects junk', () => {
  for (const action of roundTrip) {
    const cmd = toRelayCommand(action);
    assert.ok(cmd);
    assert.deepEqual(commandToPublicAction(cmd), action);
  }
  assert.deepEqual(commandToPublicAction({action: 'goto', index: 2}), {
    type: 'goto',
    index: 2,
  });
  assert.equal(commandToPublicAction({action: 'goto'}), null);
  assert.equal(commandToPublicAction({action: 'dance'} as never), null);
});

test('applyPublicAction drives the shared store', () => {
  dispatchGame({type: 'APPLY_STATE', state: initialGameState});
  applyPublicAction({type: 'pointA'});
  assert.equal(getGameState().scoreA, 1);
  applyPublicAction({type: 'unpointA'});
  applyPublicAction({type: 'unpointA'});
  assert.equal(getGameState().scoreA, 0);

  // No deck loaded in this environment: moves that need cards no-op.
  const before = getGameState();
  applyPublicAction({type: 'correct'});
  applyPublicAction({type: 'skip'});
  applyPublicAction({type: 'start'});
  assert.strictEqual(getGameState(), before);

  applyPublicAction({type: 'selectDeck', deckId: 'missing'});
  assert.equal(getGameState().deckId, null);

  dispatchGame({type: 'APPLY_STATE', state: initialGameState});
});
