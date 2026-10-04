import {useEffect} from 'react';
import {useGame} from './useGame';

/** Select the route's deck on direct loads (the teacher deck picker selects
 *  on tap; this covers pasted/bookmarked console and projector URLs).
 *  Never clobbers a game in progress: switching decks mid-round wipes the
 *  scores, so that stays an explicit choice on the Decks page. */
export function useEnsureDeckSelected(deckId: string | undefined) {
  const {state, mutate} = useGame();
  useEffect(() => {
    if (!deckId || state.deckId === deckId) return;
    const quiescent =
      state.phase === 'idle' || (state.scoreA === 0 && state.scoreB === 0);
    if (quiescent) {
      mutate({type: 'selectDeck', deckId});
    }
  }, [deckId, state.deckId, state.phase, state.scoreA, state.scoreB, mutate]);
}
