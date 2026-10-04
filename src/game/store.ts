import {gameReducer, initialGameState, type GameAction, type GameState} from './state';

/**
 * Module-level game store. State lives outside React so it survives route
 * navigation (the router shell must stay exactly
 * BrowserRouter > ReactRouterNavigationProvider > App > ReactRouterPageTransition,
 * so no provider can sit above the pages).
 */

let currentState: GameState = initialGameState;
const listeners = new Set<() => void>();

export function getGameState(): GameState {
  return currentState;
}

export function subscribeGameState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function dispatchGame(action: GameAction): void {
  const next = gameReducer(currentState, action);
  if (next !== currentState) {
    currentState = next;
    listeners.forEach(listener => listener());
    syncTimer();
  }
}

// The 60-second round clock: one interval only while running, cleared on
// pause/complete/idle. Hidden pages pause instead of drifting.
let intervalId: number | null = null;

function syncTimer(): void {
  if (typeof window === 'undefined') return;
  if (currentState.phase === 'running' && intervalId === null) {
    intervalId = window.setInterval(() => {
      dispatchGame({type: 'TICK'});
    }, 1000);
  } else if (currentState.phase !== 'running' && intervalId !== null) {
    window.clearInterval(intervalId);
    intervalId = null;
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      dispatchGame({type: 'PAUSE'});
    }
  });
}
