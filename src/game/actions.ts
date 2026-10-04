import {getDeck, shuffledOrder} from '../domain';
import type {GameAction, GameState} from './state';
import {dispatchGame, getGameState} from './store';
import type {RelayCommand} from './bus';

export type PublicAction =
  | {type: 'start'}
  | {type: 'pause'}
  | {type: 'resume'}
  | {type: 'correct'}
  | {type: 'skip'}
  | {type: 'end'}
  | {type: 'reset'}
  | {type: 'goto'; index: number}
  | {type: 'pointA'}
  | {type: 'pointB'}
  | {type: 'unpointA'}
  | {type: 'unpointB'}
  | {type: 'switchTeam'}
  | {type: 'reveal'}
  | {type: 'hide'}
  | {type: 'selectDeck'; deckId: string};

export function toRelayCommand(action: PublicAction): RelayCommand | null {
  switch (action.type) {
    case 'start':
      return {action: 'start'};
    case 'pause':
      return {action: 'pause'};
    case 'resume':
      return {action: 'resume'};
    case 'correct':
      return {action: 'correct'};
    case 'skip':
      return {action: 'skip'};
    case 'end':
      return {action: 'end'};
    case 'reset':
      return {action: 'reset'};
    case 'goto':
      return {action: 'goto', index: action.index};
    case 'pointA':
      return {action: 'pointA'};
    case 'pointB':
      return {action: 'pointB'};
    case 'unpointA':
      return {action: 'unpointA'};
    case 'unpointB':
      return {action: 'unpointB'};
    case 'switchTeam':
      return {action: 'switchTeam'};
    case 'reveal':
      return {action: 'reveal'};
    case 'hide':
      return {action: 'hide'};
    case 'selectDeck':
      return null;
  }
}

function toGameAction(action: PublicAction, state: GameState): GameAction | null {
  switch (action.type) {
    case 'start': {
      const deck = getDeck(state.deckId ?? undefined);
      if (!deck) return null;
      return {type: 'START_ROUND', order: shuffledOrder(deck.cards.length)};
    }
    case 'pause':
      return {type: 'PAUSE'};
    case 'resume':
      return {type: 'RESUME'};
    case 'correct':
      return {type: 'CORRECT'};
    case 'skip':
      return {type: 'SKIP'};
    case 'end':
      return {type: 'END_ROUND'};
    case 'reset':
      return {type: 'RESET_ROUND'};
    case 'goto':
      return {type: 'GOTO', index: action.index};
    case 'pointA':
      return {type: 'POINT', team: 'A', delta: 1};
    case 'pointB':
      return {type: 'POINT', team: 'B', delta: 1};
    case 'unpointA':
      return {type: 'POINT', team: 'A', delta: -1};
    case 'unpointB':
      return {type: 'POINT', team: 'B', delta: -1};
    case 'switchTeam':
      return {type: 'SWITCH_TEAM'};
    case 'reveal':
      return {type: 'SET_REVEALED', revealed: true};
    case 'hide':
      return {type: 'SET_REVEALED', revealed: false};
    case 'selectDeck': {
      const deck = getDeck(action.deckId);
      if (!deck) return null;
      return {
        type: 'SELECT_DECK',
        deckId: deck.id,
        order: shuffledOrder(deck.cards.length),
      };
    }
  }
}

export function commandToPublicAction(
  command: RelayCommand,
): PublicAction | null {
  if (command.action === 'goto' && typeof command.index === 'number') {
    return {type: 'goto', index: command.index};
  }
  switch (command.action) {
    case 'start':
      return {type: 'start'};
    case 'pause':
      return {type: 'pause'};
    case 'resume':
      return {type: 'resume'};
    case 'correct':
      return {type: 'correct'};
    case 'skip':
      return {type: 'skip'};
    case 'end':
      return {type: 'end'};
    case 'reset':
      return {type: 'reset'};
    case 'pointA':
      return {type: 'pointA'};
    case 'pointB':
      return {type: 'pointB'};
    case 'unpointA':
      return {type: 'unpointA'};
    case 'unpointB':
      return {type: 'unpointB'};
    case 'switchTeam':
      return {type: 'switchTeam'};
    case 'reveal':
      return {type: 'reveal'};
    case 'hide':
      return {type: 'hide'};
    default:
      return null;
  }
}

/** Apply a public action to the local store (the same path the UI uses). */
export function applyPublicAction(action: PublicAction): void {
  const gameAction = toGameAction(action, getGameState());
  if (gameAction) dispatchGame(gameAction);
}
