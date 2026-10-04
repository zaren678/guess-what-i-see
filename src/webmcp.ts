import {getDeck} from './domain';
import type {GameState} from './game/state';
import type {PublicAction} from './game/actions';

/**
 * WebMCP plumbing so the wearer can drive the game by speaking to Meta AI.
 * The tool definitions themselves live in the rendered CluePage; this module
 * holds only the shared helpers. The app stays fully usable by D-pad with no
 * assistant at all.
 */

export type ModelContextTool = {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, {type: string; description: string}>;
    required: string[];
  };
  annotations?: {readOnlyHint?: boolean};
  execute: (
    args: Record<string, unknown>,
    context: {signal: AbortSignal},
  ) => Promise<unknown> | unknown;
};

export type ModelContext = {
  registerTool: (
    tool: ModelContextTool,
    options?: {signal?: AbortSignal},
  ) => unknown;
  getTools?: () => Promise<unknown>;
};

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

export type GameToolsApi = {
  getState: () => GameState;
  mutate: (action: PublicAction) => void;
  /** True when mutations travel to the teacher console over the relay. */
  isLinked: () => boolean;
};

export type Snapshot = {
  deckTitle: string | null;
  clueNumber: number | null;
  totalClues: number;
  word: string | null;
  category: string | null;
  forbiddenWords: string[];
  hint: string | null;
  phase: GameState['phase'];
  remainingSeconds: number;
  scoreA: number;
  scoreB: number;
  currentTeam: GameState['currentTeam'];
};

export function snapshotOf(state: GameState): Snapshot {
  const deck = getDeck(state.deckId ?? undefined);
  const card =
    deck && state.order.length > 0
      ? deck.cards[state.order[state.clueIndex]]
      : undefined;
  return {
    deckTitle: deck?.title ?? null,
    clueNumber: deck && state.order.length > 0 ? state.clueIndex + 1 : null,
    totalClues: deck?.cards.length ?? 0,
    word: card?.word ?? null,
    category: card?.category ?? null,
    forbiddenWords: card?.forbiddenWords ?? [],
    hint: card?.hint ?? null,
    phase: state.phase,
    remainingSeconds: state.remainingSeconds,
    scoreA: state.scoreA,
    scoreB: state.scoreB,
    currentTeam: state.currentTeam,
  };
}

export function describeGame(snapshot: Snapshot): string {
  return (
    `Deck "${snapshot.deckTitle}", clue ${snapshot.clueNumber} of ${snapshot.totalClues}. ` +
    `Secret word "${snapshot.word}" (${snapshot.category}); do-not-say: ${snapshot.forbiddenWords.join(', ') || 'none'}. ` +
    `Phase ${snapshot.phase}, ${snapshot.remainingSeconds}s left. ` +
    `Team A ${snapshot.scoreA}, Team B ${snapshot.scoreB}; describing team ${snapshot.currentTeam}.`
  );
}

export function problem(message: string, next_action: string) {
  return JSON.stringify({error: true, message, next_action});
}

export function ok(result: Record<string, unknown>) {
  return JSON.stringify(result);
}

export function safeRegister(
  ctx: ModelContext,
  tool: ModelContextTool,
  signal?: AbortSignal,
) {
  try {
    const result = ctx.registerTool(tool, signal ? {signal} : undefined);
    if (typeof (result as PromiseLike<unknown>)?.then === 'function') {
      (result as PromiseLike<unknown>).then(undefined, (err: unknown) =>
        console.error(`${tool.name} registration failed`, err),
      );
    }
  } catch (err) {
    console.error(`${tool.name} registration failed`, err);
  }
}

export const EMPTY_SCHEMA = {
  type: 'object' as const,
  properties: {},
  required: [] as string[],
};
