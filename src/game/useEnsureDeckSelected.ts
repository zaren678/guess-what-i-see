import {useEffect} from 'react';
import {useGame} from './useGame';

/** Select the route's deck on direct loads (the teacher deck picker selects
 *  on tap; this covers pasted/bookmarked console and projector URLs). */
export function useEnsureDeckSelected(deckId: string | undefined) {
  const {state, mutate} = useGame();
  useEffect(() => {
    if (deckId && state.deckId !== deckId) {
      mutate({type: 'selectDeck', deckId});
    }
  }, [deckId, state.deckId, mutate]);
}
