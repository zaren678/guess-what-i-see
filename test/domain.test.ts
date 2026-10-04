import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCountdown,
  getDeck,
  normalizeDeck,
  shuffledOrder,
} from '../src/domain';

test('formatCountdown renders MM:SS and degrades safely', () => {
  assert.equal(formatCountdown(60), '01:00');
  assert.equal(formatCountdown(61), '01:01');
  assert.equal(formatCountdown(5), '00:05');
  assert.equal(formatCountdown(0), '00:00');
  assert.equal(formatCountdown(-3), '00:00');
  assert.equal(formatCountdown(65.9), '01:05');
  assert.equal(formatCountdown(NaN), '00:00');
  assert.equal(formatCountdown(Infinity), '00:00');
});

test('shuffledOrder returns a fresh permutation', () => {
  const order = shuffledOrder(5);
  assert.equal(order.length, 5);
  assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3, 4]);
  assert.deepEqual(shuffledOrder(0), []);
  const again = shuffledOrder(5);
  assert.notStrictEqual(order, again);
});

test('normalizeDeck keeps good cards and warns about dropped ones', () => {
  const raw = {
    id: 'test',
    title: 'Test',
    cards: [
      {word: 'Noah', category: 'Person', forbiddenWords: ['ark'], hint: 'Boat.'},
      {word: 'Bad', category: 'Person'},
      'not a card',
      {word: 'Moses', category: 'Person', forbiddenWords: []},
    ],
  };
  let warnings = 0;
  const origWarn = console.warn;
  console.warn = () => {
    warnings += 1;
  };
  try {
    const deck = normalizeDeck(raw);
    assert.ok(deck);
    assert.equal(deck.id, 'test');
    assert.deepEqual(
      deck.cards.map(c => c.word),
      ['Noah', 'Moses'],
    );
    assert.equal(deck.cards[0].hint, 'Boat.');
    assert.equal(warnings, 1);
  } finally {
    console.warn = origWarn;
  }
});

test('normalizeDeck rejects decks with no usable cards', () => {
  assert.equal(normalizeDeck(null), null);
  assert.equal(normalizeDeck({}), null);
  assert.equal(normalizeDeck({id: 'x', title: 'X', cards: []}), null);
  assert.equal(
    normalizeDeck({id: 'x', title: 'X', cards: [{nope: true}]}),
    null,
  );
  assert.equal(normalizeDeck({id: 'x', title: 'X'}), null);
});

test('getDeck misses cleanly without bundled decks', () => {
  assert.equal(getDeck(undefined), undefined);
  assert.equal(getDeck('nope'), undefined);
});
