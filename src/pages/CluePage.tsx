import {useEffect, useRef, useState} from 'react';
import {
  Chip,
  ChipStyle,
  Page,
  Panel,
  ScrollView,
  SliderBar,
  SliderBarSize,
  TextColor,
  TextStyle,
  TextView,
} from '@wearables-ui-toolkit/mrbd';
import {formatCountdown, ROUND_SECONDS, getDeck} from '../domain';
import {useGame, type PublicAction} from '../game/useGame';
import {
  EMPTY_SCHEMA,
  describeGame,
  ok,
  problem,
  safeRegister,
  snapshotOf,
  type GameToolsApi,
  type ModelContext,
  type Snapshot,
} from '../webmcp';

type VoiceTool = {
  name: string;
  /** Used as the assistant-facing tool description. */
  copy: string;
  action: PublicAction;
  needsRunning: boolean;
  result: (snapshot: Snapshot) => Record<string, unknown>;
};

/** The five mutating voice tools for the round, defined once as data. */
const VOICE_TOOLS: VoiceTool[] = [
  {
    name: 'mark_correct',
    copy: 'Say "we got it" to score a point.',
    action: {type: 'correct'},
    needsRunning: true,
    result: snapshot => ({
      awardedTo: `Team ${snapshot.currentTeam}`,
      scoreA: snapshot.scoreA,
      scoreB: snapshot.scoreB,
      nextWord: snapshot.word,
      clueNumber: snapshot.clueNumber,
    }),
  },
  {
    name: 'skip_clue',
    copy: 'Say "skip this one" to skip a clue.',
    action: {type: 'skip'},
    needsRunning: true,
    result: snapshot => ({
      skipped: true,
      nextWord: snapshot.word,
      clueNumber: snapshot.clueNumber,
    }),
  },
  {
    name: 'pause_game',
    copy: 'Say "pause the game" to pause.',
    action: {type: 'pause'},
    needsRunning: true,
    result: snapshot => ({
      phase: snapshot.phase,
      remainingSeconds: snapshot.remainingSeconds,
    }),
  },
  {
    name: 'resume_game',
    copy: 'Say "resume" to restart the clock.',
    action: {type: 'resume'},
    needsRunning: false,
    result: snapshot => {
      if (snapshot.phase !== 'running') {
        return {
          error: true,
          message: `The round is ${snapshot.phase}, not paused.`,
        };
      }
      return {
        phase: snapshot.phase,
        remainingSeconds: snapshot.remainingSeconds,
      };
    },
  },
  {
    name: 'start_round',
    copy: 'Say "start the round" to begin.',
    action: {type: 'start'},
    needsRunning: false,
    result: snapshot => {
      if (snapshot.phase !== 'running') {
        return {
          error: true,
          message: `The round is ${snapshot.phase}; it did not start.`,
        };
      }
      return {
        phase: snapshot.phase,
        remainingSeconds: snapshot.remainingSeconds,
        firstWord: snapshot.word,
      };
    },
  },
];

const STATE_TOOL_COPY = 'Say "what\'s the score" for the score and time.';

/** Wire up the six voice tools for Meta AI on the glasses. */
function registerGameTools(
  ctx: ModelContext,
  api: GameToolsApi,
  signal?: AbortSignal,
) {
  safeRegister(
    ctx,
    {
      name: 'get_game_state',
      description: STATE_TOOL_COPY,
      inputSchema: EMPTY_SCHEMA,
      annotations: {readOnlyHint: true},
      execute: () => {
        const snapshot = snapshotOf(api.getState());
        return ok({
          ...snapshot,
          summary: describeGame(snapshot),
          next_action: 'Use these facts to answer the wearer. Stop and talk.',
        });
      },
    },
    signal,
  );

  for (const tool of VOICE_TOOLS) {
    safeRegister(
      ctx,
      {
        name: tool.name,
        description: tool.copy,
        inputSchema: EMPTY_SCHEMA,
        execute: () => {
          const before = snapshotOf(api.getState());
          if (tool.needsRunning && before.phase !== 'running') {
            return problem(
              `The round is ${before.phase}; this only works while a round is running.`,
              before.phase === 'idle' || before.phase === 'complete'
                ? 'Offer to start a new round with start_round. Stop and talk.'
                : 'Offer to resume with resume_game. Stop and talk.',
            );
          }
          api.mutate(tool.action);
          if (api.isLinked()) {
            return ok({
              requested: tool.name,
              note: 'Sent to the teacher console; the glasses update on the next sync.',
              next_action:
                'Confirm the action in one short sentence. Stop and talk.',
            });
          }
          const after = snapshotOf(api.getState());
          return ok({
            ...tool.result(after),
            summary: describeGame(after),
            next_action:
              'Confirm the result in one short sentence. Stop and talk.',
          });
        },
      },
      signal,
    );
  }
}

function Eyebrow({children}: {children: React.ReactNode}) {
  return (
    <TextView as="p" textStyle={TextStyle.LABEL} textColor={TextColor.SECONDARY}>
      {children}
    </TextView>
  );
}

function LinkBadge({connected}: {connected: boolean}) {
  return (
    <TextView as="p" textStyle={TextStyle.META1} textColor={TextColor.SECONDARY}>
      {connected ? 'Linked' : 'Offline'}
    </TextView>
  );
}

/** Transient on-glasses banner for scoring moments. Derived locally by
 *  watching synced state transitions -- the cloud only carries snapshots,
 *  so the glasses infer "got it" vs "skipped" from what changed. */
type Flash = {text: string} | null;

/** Seconds left at which the timer switches to its hurry-up treatment. */
const HURRY_SECONDS = 10;
/** How long a celebration banner stays up (roughly one sync cycle). */
const FLASH_MS = 2600;

function winnerOf(scoreA: number, scoreB: number): 'A' | 'B' | null {
  if (scoreA === scoreB) return null;
  return scoreA > scoreB ? 'A' : 'B';
}

/**
 * Glasses `/`: a pure display for the describer. The teacher drives
 * everything from the laptop; this screen shows the countdown, the secret
 * word with its don't-say words, and celebration moments. Voice commands
 * keep working as a backup.
 */
export function CluePage() {
  const {state, mutate, connected} = useGame();
  const stateRef = useRef(state);
  stateRef.current = state;
  const linkRef = useRef({connected, mutate});
  linkRef.current = {connected, mutate};

  // Celebration state: a transient banner plus a consecutive-got-it streak.
  // Both derive from synced snapshot transitions, so missed polls degrade
  // gracefully (a +2 jump still flashes once with the right delta).
  const total = state.scoreA + state.scoreB;
  const [flash, setFlash] = useState<Flash>(null);
  const [streak, setStreak] = useState(0);
  const prevRef = useRef({clueIndex: state.clueIndex, total, phase: state.phase});

  useEffect(() => {
    const prev = prevRef.current;
    const phaseChanged = state.phase !== prev.phase;
    if (
      (phaseChanged &&
        state.phase === 'running' &&
        (prev.phase === 'idle' || prev.phase === 'complete')) ||
      (phaseChanged && state.phase === 'idle')
    ) {
      // Fresh round (or reset): streaks don't carry over.
      setStreak(0);
      setFlash(null);
    } else if (total > prev.total && state.phase === 'running') {
      // Running only: the teacher's score steppers also work while
      // paused, and those quiet adjustments must not flash or streak.
      const delta = total - prev.total;
      setStreak(s => s + delta);
      setFlash({
        text:
          delta === 1
            ? `Got it! +1 for Team ${state.currentTeam}`
            : `+${delta} for Team ${state.currentTeam} — way to go!`,
      });
    } else if (state.phase === 'running' && state.order.length > 0) {
      // Only a forward step counts as a skip -- the teacher's Prev/Next
      // navigation shouldn't flash (or reset the streak) on a rewind.
      const advanced =
        state.clueIndex === (prev.clueIndex + 1) % state.order.length;
      if (advanced && total === prev.total) {
        setStreak(0);
        setFlash({text: 'Skipped — next word!'});
      }
    }
    prevRef.current = {clueIndex: state.clueIndex, total, phase: state.phase};
  }, [state.clueIndex, state.phase, state.currentTeam, state.order.length, total]);

  // Celebration banners clear after one sync cycle.
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  // WebMCP: the wearer can drive the round by speaking to Meta AI.
  useEffect(() => {
    const ctx = document.modelContext;
    if (!ctx?.registerTool) return;
    const api: GameToolsApi = {
      getState: () => stateRef.current,
      mutate: (action: PublicAction) => linkRef.current.mutate(action),
      isLinked: () => linkRef.current.connected,
    };
    const controller = new AbortController();
    registerGameTools(ctx, api, controller.signal);
    return () => controller.abort();
  }, []);

  // The deck comes only from synced teacher state -- the glasses never
  // pick decks (deck selection lives on the teacher console).
  const deck = getDeck(state.deckId ?? undefined);
  const card =
    deck && state.order.length > 0
      ? deck.cards[state.order[state.clueIndex]]
      : undefined;
  const phase = state.phase;
  const playing = phase === 'running' || phase === 'paused';
  const lowTime = state.remainingSeconds <= HURRY_SECONDS;
  const winner = winnerOf(state.scoreA, state.scoreB);

  return (
    <Page headerText="Clue" enableSystemBarInset={false}>
      <ScrollView insetForHeader tabIndex={0} ariaLabel="Clue display">
        <Panel width="100%">
          <div className="content-inset">
            {phase === 'idle' && (
              <>
                <TextView as="h2" textStyle={TextStyle.HEADING2}>
                  You're the describer!
                </TextView>
                {deck && (
                  <TextView as="p" textStyle={TextStyle.BODY2}>
                    {deck.title}
                  </TextView>
                )}
                <TextView
                  as="p"
                  textStyle={TextStyle.BODY2}
                  textColor={TextColor.SECONDARY}>
                  Waiting for teacher to start the round…
                </TextView>
                <LinkBadge connected={connected} />
              </>
            )}

            {playing && card && (
              <>
                <Chip
                  text={`Team ${state.currentTeam} describes`}
                  chipStyle={ChipStyle.EMPHASIZED}
                />
                <TextView
                  as="p"
                  textStyle={TextStyle.NUMERAL2}
                  textColor={lowTime ? TextColor.ACCENT : TextColor.PRIMARY}>
                  {formatCountdown(state.remainingSeconds)}
                </TextView>
                <SliderBar
                  minimumValue={0}
                  maximumValue={ROUND_SECONDS}
                  value={state.remainingSeconds}
                  size={SliderBarSize.THIN}
                  animated
                />
                {lowTime && phase === 'running' && (
                  <TextView
                    as="p"
                    textStyle={TextStyle.LABEL_EMPHASIZED}
                    textColor={TextColor.ACCENT}>
                    Hurry — almost out of time!
                  </TextView>
                )}
                {flash && (
                  <Chip text={flash.text} chipStyle={ChipStyle.ELEVATED} />
                )}
                {streak >= 2 && (
                  <TextView
                    as="p"
                    textStyle={TextStyle.LABEL_EMPHASIZED}
                    textColor={TextColor.ACCENT}>
                    {streak} in a row — keep going!
                  </TextView>
                )}
                <Eyebrow>{card.category}</Eyebrow>
                <TextView as="p" textStyle={TextStyle.HEADING1}>
                  {card.word}
                </TextView>
                <TextView
                  as="p"
                  textStyle={TextStyle.BODY2}
                  textColor={TextColor.SECONDARY}>
                  Clue {state.clueIndex + 1} of {state.order.length}
                </TextView>
                {card.forbiddenWords.length > 0 && (
                  <>
                    <Eyebrow>Don't say</Eyebrow>
                    <TextView as="p" textStyle={TextStyle.BODY2}>
                      {card.forbiddenWords.join(', ')}
                    </TextView>
                  </>
                )}
                {card.hint && (
                  <>
                    <Eyebrow>Hint</Eyebrow>
                    <TextView as="p" textStyle={TextStyle.BODY2}>
                      {card.hint}
                    </TextView>
                  </>
                )}
                {phase === 'paused' && (
                  <TextView as="p" textStyle={TextStyle.BODY2}>
                    Paused — waiting for teacher…
                  </TextView>
                )}
                <LinkBadge connected={connected} />
              </>
            )}

            {phase === 'complete' && (
              <>
                <TextView as="h2" textStyle={TextStyle.HEADING2}>
                  {winner ? `Team ${winner} wins!` : `It's a tie!`}
                </TextView>
                <TextView as="p" textStyle={TextStyle.BODY2}>
                  Team A {state.scoreA} · Team B {state.scoreB}
                </TextView>
                <LinkBadge connected={connected} />
              </>
            )}
          </div>
        </Panel>
      </ScrollView>
    </Page>
  );
}
