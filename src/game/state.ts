import {useCallback, useEffect, useRef, useState} from 'react';
import {ROUND_SECONDS} from '../domain';

export type RoundPhase = 'idle' | 'running' | 'paused' | 'complete';
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
};

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
};

export type GameAction =
  | {type: 'SELECT_DECK'; deckId: string; order: number[]}
  | {type: 'START_ROUND'; order: number[]}
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
      };    case 'START_ROUND':
      if (state.order.length === 0) return state;
      return {
        ...state,
        order: action.order,
        clueIndex: 0,
        phase: 'running',
        remainingSeconds: ROUND_SECONDS,
      };
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
