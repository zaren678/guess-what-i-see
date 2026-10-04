import {ListItem, Page, VerticalList} from '@wearables-ui-toolkit/mrbd';
import {useNavigate} from 'react-router-dom';
import {DECKS} from '../domain';
import {useGame} from '../game/useGame';

/** Laptop `/teacher`: pick the deck the class will play. */
export function TeacherDecksPage() {
  const navigate = useNavigate();
  const {mutate} = useGame();

  return (
    <Page headerText="Teacher setup" enableSystemBarInset={false}>
      <VerticalList insetForHeader ariaLabel="Decks">
        {DECKS.map(deck => (
          <ListItem
            key={deck.id}
            title={deck.title}
            subtitle={`${deck.cards.length} clues`}
            onClick={() => {
              mutate({type: 'selectDeck', deckId: deck.id});
              navigate(`/teacher/${deck.id}`);
            }}
          />
        ))}
      </VerticalList>
    </Page>
  );
}
