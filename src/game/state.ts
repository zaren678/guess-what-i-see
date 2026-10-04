import {useCallback, useEffect, useRef, useState} from 'react';
import {ROUND_SECONDS} from '../domain';

export type RoundPhase =
  | 'idle'
  | 'starting'
  | 'running'
  | 'paused'
  | 'complete';
export type Team = 'A' | 'B';

export type GameState = {
  deckId: string | null;
  /** Shuffled card indices for the current round. */
  order: number[];
  /** Position inside `order`. */
  clueIndex: number;
  phase: RoundPhase;
  remainingSeconds: number;
  scoreA: number;
  scoreB: number;
  currentTeam: Team;
  /** Teacher-side reveal of the secret word. */
  revealed: boolean;
  /**
   * Handshake nonce for the current start. The teacher sets it on Start; the
   * glasses echoes it back in `ackedId` once the word is on screen; only
   * then does the teacher begin the clock. Empty when no start is pending.
   */
  startId: string;
  /** Last start nonce the glasses confirmed rendering. */
  ackedId: string;
};

/** Runtime shape check for snapshots arriving over the cloud link or the
 *  relay. The reducer trusts dispatched actions; this guards the boundary
 *  so a malformed snapshot can never wedge both screens until reset. */
export function isGameState(value: unknown): value is GameState {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    (typeof s.deckId === 'string' || s.deckId === null) &&
    Array.isArray(s.order) &&
    s.order.length <= 10000 &&
    s.order.every(
      (i: unknown) => typeof i === 'number' && Number.isInteger(i) && i >= 0,
    ) &&
    typeof s.clueIndex === 'number' &&
    Number.isInteger(s.clueIndex) &&
    s.clueIndex >= 0 &&
    (s.phase === 'idle' ||
      s.phase === 'starting' ||
      s.phase === 'running' ||
      s.phase === 'paused' ||
      s.phase === 'complete') &&
    typeof s.remainingSeconds === 'number' &&
    Number.isFinite(s.remainingSeconds) &&
    typeof s.scoreA === 'number' &&
    Number.isFinite(s.scoreA) &&
    typeof s.scoreB === 'number' &&
    Number.isFinite(s.scoreB) &&
    (s.currentTeam === 'A' || s.currentTeam === 'B') &&
    typeof s.revealed === 'boolean' &&
    typeof s.startId === 'string' &&
    typeof s.ackedId === 'string'
  );
}

/** True when a store transition is just the 1-second round clock. The cloud
 *  link skips these (each side ticks locally from the last synced snapshot)
 *  so the timer alone never burns uploads. */
export function isTickOnly(prev: GameState, next: GameState): boolean {
  return (
    prev.phase === 'running' &&
    next.phase === 'running' &&
    next.remainingSeconds === prev.remainingSeconds - 1 &&
    prev.deckId === next.deckId &&
    prev.clueIndex === next.clueIndex &&
    prev.scoreA === next.scoreA &&
    prev.scoreB === next.scoreB &&
    prev.currentTeam === next.currentTeam &&
    prev.revealed === next.revealed &&
    prev.order === next.order
  );
}

export const initialGameState: GameState = {
  deckId: null,
  order: [],
  clueIndex: 0,
  phase: 'idle',
  remainingSeconds: ROUND_SECONDS,
  scoreA: 0,
  scoreB: 0,
  currentTeam: 'A',
  revealed: false,
  startId: '',
  ackedId: '',
};

export type GameAction =
  | {type: 'SELECT_DECK'; deckId: string; order: number[]}
  | {type: 'START_ROUND'; order: number[]; startId: string}
  | {type: 'BEGIN_ROUND'}
  | {type: 'SET_ACKED'; ackedId: string}
  | {type: 'PAUSE'}
  | {type: 'RESUME'}
  | {type: 'CORRECT'}
  | {type: 'SKIP'}
  | {type: 'GOTO'; index: number}
  | {type: 'END_ROUND'}
  | {type: 'RESET_ROUND'}
  | {type: 'TICK'}
  | {type: 'POINT'; team: Team; delta: 1 | -1}
  | {type: 'SWITCH_TEAM'}
  | {type: 'SET_REVEALED'; revealed: boolean}
  | {type: 'APPLY_STATE'; state: GameState};

function advance(state: GameState): GameState {
  if (state.order.length === 0) return state;
  return {...state, clueIndex: (state.clueIndex + 1) % state.order.length};
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'SELECT_DECK':
      return {
        ...initialGameState,
        deckId: action.deckId,
        order: action.order,
      };    case 'START_ROUND': {
      if (action.order.length === 0) return state;
      // Pressing Start while starting begins immediately (the fallback when
      // the glasses never acked).
      if (state.phase === 'starting') {
        return {
          ...state,
          phase: 'running',
          clueIndex: 0,
          remainingSeconds: ROUND_SECONDS,
        };
      }
      // Mid-game restarts skip the handshake and run at once.
      if (state.phase !== 'idle') {
        return {
          ...state,
          order: action.order,
          clueIndex: 0,
          phase: 'running',
          remainingSeconds: ROUND_SECONDS,
          startId: action.startId,
          ackedId: action.startId,
        };
      }
      // Fresh start: hold the clock in `starting` until the glasses echoes
      // the nonce back. The timer only ever ticks while running.
      return {
        ...state,
        order: action.order,
        clueIndex: 0,
        phase: 'starting',
        remainingSeconds: ROUND_SECONDS,
        startId: action.startId,
        ackedId: '',
      };
    }
    case 'BEGIN_ROUND':
      if (state.phase !== 'starting') return state;
      return {
        ...state,
        phase: 'running',
        clueIndex: 0,
        remainingSeconds: ROUND_SECONDS,
      };
    case 'SET_ACKED':
      return {...state, ackedId: action.ackedId};
    case 'PAUSE':
      return state.phase === 'running' ? {...state, phase: 'paused'} : state;
    case 'RESUME':
      return state.phase === 'paused' ? {...state, phase: 'running'} : state;
    case 'CORRECT': {
      if (state.phase !== 'running' || state.order.length === 0) return state;
      const next = advance(state);
      return {
        ...next,
        scoreA: state.scoreA + (state.currentTeam === 'A' ? 1 : 0),
        scoreB: state.scoreB + (state.currentTeam === 'B' ? 1 : 0),
      };
    }
    case 'SKIP':
      return state.phase === 'running' ? advance(state) : state;
    case 'GOTO': {
      if (state.order.length === 0) return state;
      const index =
        ((action.index % state.order.length) + state.order.length) %
        state.order.length;
      return {...state, clueIndex: index};
    }
    case 'END_ROUND':
      return state.phase === 'running' || state.phase === 'paused'
        ? {...state, phase: 'complete', remainingSeconds: 0}
        : state;
    case 'RESET_ROUND':
      return {
        ...state,
        phase: 'idle',
        remainingSeconds: ROUND_SECONDS,
        clueIndex: 0,
        scoreA: 0,
        scoreB: 0,
        currentTeam: 'A',
        revealed: false,
        startId: '',
        ackedId: '',
      };
    case 'TICK': {
      if (state.phase !== 'running') return state;
      const remaining = state.remainingSeconds - 1;
      if (remaining <= 0) {
        return {...state, remainingSeconds: 0, phase: 'complete'};
      }
      return {...state, remainingSeconds: remaining};
    }
    case 'POINT':
      if (action.delta === 1) {
        return action.team === 'A'
          ? {...state, scoreA: state.scoreA + 1}
          : {...state, scoreB: state.scoreB + 1};
      }
      return action.team === 'A'
        ? {...state, scoreA: Math.max(0, state.scoreA - 1)}
        : {...state, scoreB: Math.max(0, state.scoreB - 1)};
    case 'SWITCH_TEAM':
      return {...state, currentTeam: state.currentTeam === 'A' ? 'B' : 'A'};
    case 'SET_REVEALED':
      return {...state, revealed: action.revealed};
    case 'APPLY_STATE':
      return action.state;
    default:
      return state;
  }
}
