import {useCallback, useEffect} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {formatCountdown, getDeck} from '../domain';
import {useGame, type PublicAction} from '../game/useGame';
import {useEnsureDeckSelected} from '../game/useEnsureDeckSelected';
import type {RoundPhase} from '../game/state';
import '../teacher.css';

/** Laptop-only teacher console (`/teacher/:deckId`). */

function phaseLabel(phase: RoundPhase): string {
  switch (phase) {
    case 'idle':
      return 'Ready';
    case 'starting':
      return 'Starting';
    case 'running':
      return 'Running';
    case 'paused':
      return 'Paused';
    case 'complete':
      return 'Round over';
  }
}

/** Laptop-only teacher console (`/teacher/:deckId`). This page never runs on
 *  the glasses, so it intentionally does NOT use the Meta UI Toolkit: plain
 *  semantic HTML with its own stylesheet (src/teacher.css), sized for a
 *  laptop screen and a teacher mashing buttons mid-round. The glasses gate
 *  stubs this file (see scripts/gate.sh). */
export function TeacherConsolePage() {
  const {deckId} = useParams();
  const navigate = useNavigate();
  const deck = getDeck(deckId);
  const {state, mutate, connected, room, synced} = useGame();

  useEnsureDeckSelected(deckId);

  const go = useCallback(
    (action: PublicAction) => mutate(action),
    [mutate],
  );

  const phase = state.phase;
  const playing = phase === 'running' || phase === 'paused';
  const running = phase === 'running';

  const startPauseAction: PublicAction =
    running
      ? {type: 'pause'}
      : phase === 'paused'
        ? {type: 'resume'}
        : {type: 'start'};
  // While starting, Start begins the round: "Start timer" once the
  // glasses confirmed, "Begin now" as the fallback when they never acked.
  const acked = state.startId !== '' && state.ackedId === state.startId;
  const startPauseLabel = running
    ? 'Pause'
    : phase === 'paused'
      ? 'Resume'
      : phase === 'starting'
        ? acked
          ? 'Start timer'
          : 'Begin now'
        : 'Start';

  // Keyboard driving: G = got it, S = skip, Space = start/pause/resume,
  // N/P = next/previous clue. Ignored when typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'g') go({type: 'correct'});
      else if (k === 's') go({type: 'skip'});
      else if (k === 'n') go({type: 'goto', index: state.clueIndex + 1});
      else if (k === 'p') go({type: 'goto', index: state.clueIndex - 1});
      else if (e.key === ' ') {
        // A focused button already fires on Space natively; handling it
        // here too would double-apply the action.
        if (target && (target.tagName === 'BUTTON' || target.tagName === 'A')) {
          return;
        }
        e.preventDefault();
        go(startPauseAction);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, state.clueIndex, startPauseAction]);

  if (!deck) {
    return (
      <div className="tcon">
        <p>
          Deck not found. <a href="/teacher">Pick a deck</a>.
        </p>
      </div>
    );
  }

  const card =
    state.order.length > 0 ? deck.cards[state.order[state.clueIndex]] : undefined;

  return (
    <div className="tcon">
      <header className="tcon-head">
        <div>
          <h1 className="tcon-title">{deck.title}</h1>
          <p className="tcon-status">
            <span
              className={`tcon-dot ${connected ? 'tcon-dot--on' : ''}`}
              aria-hidden="true"
            />
            {connected ? 'Linked to glasses' : 'Offline'}
            {'  ·  '}
            {phaseLabel(phase)}
            {'  ·  '}
            <span className="tcon-timer">
              {formatCountdown(state.remainingSeconds)}
            </span>
            {'  ·  '}Room {room}
            {!synced && (
              <span className="tcon-warn">
                Not syncing — moves may not reach the glasses
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          className="tcon-btn tcon-btn--ghost"
          onClick={() => navigate('/teacher')}>
          Decks
        </button>
      </header>

      <main className="tcon-main">
        <section className="tcon-card tcon-clue" aria-label="Current clue">
          {phase === 'starting' && deck ? (
            <>
              <div className="tcon-eyebrow">Starting</div>
              {acked ? (
                <>
                  <div className="tcon-word tcon-word--small">Ready</div>
                  <div className="tcon-meta">
                    The word is on the glasses. Press Start timer (Space)
                    when the describer is ready — the clock only runs
                    after that.
                  </div>
                </>
              ) : (
                <>
                  <div className="tcon-word tcon-word--small">
                    Waiting for glasses…
                  </div>
                  <div className="tcon-meta">
                    The word appears on the glasses first. Press Begin now
                    (Space) to skip waiting and start without them.
                  </div>
                </>
              )}
            </>
          ) : playing && card ? (
            <>
              <div className="tcon-eyebrow">Current clue</div>
              <div className="tcon-word">{card.word}</div>
              <div className="tcon-meta">
                {card.category} · Clue {state.clueIndex + 1} of{' '}
                {state.order.length}
              </div>
              <dl className="tcon-facts">
                <div>
                  <dt>Don't say</dt>
                  <dd>{card.forbiddenWords.join(', ')}</dd>
                </div>
                {card.hint && (
                  <div>
                    <dt>Hint</dt>
                    <dd>{card.hint}</dd>
                  </div>
                )}
              </dl>
            </>
          ) : phase === 'complete' ? (
            <>
              <div className="tcon-eyebrow">Round over</div>
              <div className="tcon-word tcon-word--small">
                {state.score} correct!
              </div>
              <div className="tcon-meta">
                Pass the glasses to the next describer for another round.
              </div>
            </>
          ) : (
            <>
              <div className="tcon-eyebrow">Ready</div>
              <div className="tcon-word tcon-word--small">{deck.title}</div>
              <div className="tcon-meta">
                {deck.cards.length} clues loaded — press Start round when the
                class is ready. The glasses are showing "Waiting for teacher…".
              </div>
            </>
          )}
        </section>

        <aside className="tcon-side">
          <section className="tcon-card tcon-drive" aria-label="Round controls">
            <button
              type="button"
              className="tcon-btn tcon-btn--primary"
              disabled={!running}
              onClick={() => go({type: 'correct'})}>
              Got it ✓ <kbd>G</kbd>
            </button>
            <div className="tcon-row">
              <button
                type="button"
                className="tcon-btn"
                disabled={!running}
                onClick={() => go({type: 'skip'})}>
                Skip <kbd>S</kbd>
              </button>
              <button
                type="button"
                className="tcon-btn"
                onClick={() => go(startPauseAction)}>
                {startPauseLabel} <kbd>Space</kbd>
              </button>
            </div>
            <button
              type="button"
              className="tcon-btn tcon-btn--ghost"
              disabled={!playing}
              onClick={() => go({type: 'end'})}>
              End round
            </button>
          </section>

          <section className="tcon-card tcon-score" aria-label="Scoreboard">
            <div className="tcon-eyebrow">Score</div>
            <div className="tcon-team tcon-team--active">
              <strong className="tcon-team__score">{state.score}</strong>
              <span className="tcon-stepper">
                <button
                  type="button"
                  aria-label="Score +1"
                  onClick={() => go({type: 'scoreUp'})}>
                  +
                </button>
                <button
                  type="button"
                  aria-label="Score −1"
                  onClick={() => go({type: 'scoreDown'})}>
                  −
                </button>
              </span>
            </div>
          </section>
        </aside>
      </main>

      <footer className="tcon-foot">
        <span className="tcon-foot__group">
          <button
            type="button"
            className="tcon-btn tcon-btn--ghost"
            onClick={() => go({type: 'goto', index: state.clueIndex - 1})}>
            ‹ Prev <kbd>P</kbd>
          </button>
          <button
            type="button"
            className="tcon-btn tcon-btn--ghost"
            onClick={() => go({type: 'goto', index: state.clueIndex + 1})}>
            Next › <kbd>N</kbd>
          </button>
        </span>
        <span className="tcon-foot__group">
          <button
            type="button"
            className="tcon-btn tcon-btn--ghost"
            onClick={() => go({type: 'reset'})}>
            Reset round
          </button>
          <button
            type="button"
            className="tcon-btn tcon-btn--ghost"
            onClick={() => navigate(`/teacher/${deck.id}/projector`)}>
            Projector mode
          </button>
        </span>
      </footer>
    </div>
  );
}
