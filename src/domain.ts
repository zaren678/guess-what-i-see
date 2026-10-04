/** Domain model for Guess What I See: decks of clue cards. */

export type Card = {
  word: string;
  category: string;
  forbiddenWords: string[];
  hint?: string;
};

export type Deck = {
  id: string;
  title: string;
  blurb?: string;
  cards: Card[];
};

type DeckJson = {
  id?: unknown;
  title?: unknown;
  blurb?: unknown;
  cards?: unknown;
};

function isDeckJson(value: unknown): value is DeckJson {
  return typeof value === 'object' && value !== null;
}

/** Seconds per round. Domain behavior, not a layout value. */
export const ROUND_SECONDS = 60;

// Vite statically bundles every decks/*.json here. Outside a Vite build
// (e.g. node:test) import.meta.glob is unavailable, so there are simply no
// bundled decks and DECKS is empty.
const deckModules: Record<string, {default?: unknown}> =
  typeof import.meta.glob === 'function'
    ? import.meta.glob<{default?: unknown}>('../decks/*.json', {eager: true})
    : {};

export function normalizeDeck(raw: unknown): Deck | null {
  if (!isDeckJson(raw)) return null;
  if (typeof raw.id !== 'string' || typeof raw.title !== 'string') return null;
  if (!Array.isArray(raw.cards)) return null;
  const cards: Card[] = [];
  let dropped = 0;
  for (const entry of raw.cards) {
    if (typeof entry !== 'object' || entry === null) {
      dropped += 1;
      continue;
    }
    const card = entry as Record<string, unknown>;
    if (typeof card.word !== 'string' || typeof card.category !== 'string') {
      dropped += 1;
      continue;
    }
    if (!Array.isArray(card.forbiddenWords)) {
      dropped += 1;
      continue;
    }
    cards.push({
      word: card.word,
      category: card.category,
      forbiddenWords: card.forbiddenWords.filter(
        (w): w is string => typeof w === 'string',
      ),
      hint: typeof card.hint === 'string' ? card.hint : undefined,
    });
  }
  if (cards.length === 0) return null;
  if (dropped > 0) {
    console.warn(
      `deck "${raw.id}" loaded with ${cards.length} cards; skipped ${dropped} invalid entr${dropped === 1 ? 'y' : 'ies'}.`,
    );
  }
  return {
    id: raw.id,
    title: raw.title,
    blurb: typeof raw.blurb === 'string' ? raw.blurb : undefined,
    cards,
  };
}

export const DECKS: Deck[] = Object.values(deckModules)
  .map(module => normalizeDeck(module.default))
  .filter((deck): deck is Deck => deck !== null)
  .sort((a, b) => a.title.localeCompare(b.title));

export function getDeck(id: string | undefined): Deck | undefined {
  if (!id) return undefined;
  return DECKS.find(deck => deck.id === id);
}

/** Compact MM:SS countdown string. Non-finite input renders as 00:00. */
export function formatCountdown(totalSeconds: number): string {
  const floored = Number.isFinite(totalSeconds)
    ? Math.max(0, Math.floor(totalSeconds))
    : 0;
  const minutes = Math.floor(floored / 60);
  const seconds = floored % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Fisher-Yates shuffle returning a new array of card indices. */
export function shuffledOrder(length: number): number[] {
  const order = Array.from({length}, (_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
