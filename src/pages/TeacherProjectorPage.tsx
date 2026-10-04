import {
  Button,
  ButtonRail,
  Page,
  Panel,
  ScrollView,
  TextColor,
  TextStyle,
  TextView,
  Toast,
} from '@wearables-ui-toolkit/mrbd';
import {useParams} from 'react-router-dom';
import {formatCountdown, getDeck} from '../domain';
import {useGame, type PublicAction} from '../game/useGame';
import {useEnsureDeckSelected} from '../game/useEnsureDeckSelected';

function Eyebrow({children}: {children: React.ReactNode}) {
  return (
    <TextView as="p" textStyle={TextStyle.LABEL} textColor={TextColor.SECONDARY}>
      {children}
    </TextView>
  );
}

/**
 * Laptop `/teacher/:deckId/projector`: the class-facing display. Shows the
 * category, clock, and scores — never the secret word until the teacher
 * reveals it after the class guesses. Leave via the system Back path.
 */
export function TeacherProjectorPage() {
  const {deckId} = useParams();
  const deck = getDeck(deckId);
  const {state, mutate} = useGame();

  useEnsureDeckSelected(deckId);

  if (!deck) {
    return (
      <Page headerText="Projector" enableSystemBarInset={false}>
        <ScrollView insetForHeader tabIndex={0} ariaLabel="Deck not found">
          <div className="content-inset">
            <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
              Deck not found
            </TextView>
          </div>
        </ScrollView>
      </Page>
    );
  }

  const card =
    state.order.length > 0 ? deck.cards[state.order[state.clueIndex]] : undefined;
  const phase = state.phase;

  const announce = (action: PublicAction, message: string) => {
    mutate(action);
    Toast.show(message);
  };

  const primary: {title: string; action: PublicAction; toast: string} =
    phase === 'running'
      ? {title: 'Pause', action: {type: 'pause'}, toast: 'Paused'}
      : phase === 'paused'
        ? {title: 'Resume', action: {type: 'resume'}, toast: 'Round going'}
        : phase === 'complete'
          ? {title: 'Play again', action: {type: 'start'}, toast: 'Round started'}
          : phase === 'starting'
            ? {title: 'Begin now', action: {type: 'start'}, toast: 'Round started'}
            : {title: 'Start round', action: {type: 'start'}, toast: 'Round started'};

  return (
    <Page headerText="Projector" enableSystemBarInset={false}>
      <div className="action-page-shell">
        <ScrollView insetForHeader tabIndex={0} ariaLabel="Projector display">
          <Panel width="100%">
            <div className="content-inset">
              <Eyebrow>CATEGORY</Eyebrow>
              <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
                {card?.category ?? deck.title}
              </TextView>
              {state.revealed && card && (
                <>
                  <Eyebrow>THE WORD WAS</Eyebrow>
                  <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
                    {card.word}
                  </TextView>
                </>
              )}
              <TextView as="p" textStyle={TextStyle.META1_EMPHASIZED}>
                {formatCountdown(state.remainingSeconds)}
              </TextView>
              <Eyebrow>TEAM A</Eyebrow>
              <TextView as="p" textStyle={TextStyle.META1_EMPHASIZED}>
                {state.scoreA}
              </TextView>
              <Eyebrow>TEAM B</Eyebrow>
              <TextView as="p" textStyle={TextStyle.META1_EMPHASIZED}>
                {state.scoreB}
              </TextView>
              <TextView as="p" textStyle={TextStyle.BODY2}>
                {state.order.length > 0
                  ? `Clue ${state.clueIndex + 1} of ${state.order.length}`
                  : 'Get ready'}
              </TextView>
            </div>
          </Panel>
        </ScrollView>
        <div className="action-dock">
          <ButtonRail>
            <Button
              title={primary.title}
              onClick={() => announce(primary.action, primary.toast)}
            />
            <Button
              title={state.revealed ? 'Hide word' : 'Reveal word'}
              onClick={() => mutate(state.revealed ? {type: 'hide'} : {type: 'reveal'})}
            />
          </ButtonRail>
        </div>
      </div>
    </Page>
  );
}
