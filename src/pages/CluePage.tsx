import {useEffect, useRef} from 'react';
import {
  Page,
  Panel,
  ScrollView,
  TextColor,
  TextStyle,
  TextView,
} from '@wearables-ui-toolkit/mrbd';
import {getDeck} from '../domain';
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

/**
 * Glasses `/deck/:deckId`: a pure display for the describer. The teacher
 * drives everything from the laptop; this screen only shows the current
 * secret word (or a waiting state). Voice commands keep working as a backup.
 */
export function CluePage() {
  const {state, mutate, connected} = useGame();
  const stateRef = useRef(state);
  stateRef.current = state;
  const linkRef = useRef({connected, mutate});
  linkRef.current = {connected, mutate};

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

  return (
    <Page headerText="Clue" enableSystemBarInset={false}>
      <ScrollView insetForHeader tabIndex={0} ariaLabel="Clue display">
        <Panel width="100%">
          <div className="content-inset">
            {phase === 'idle' && (
              <>
                <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
                  Waiting for teacher…
                </TextView>
                {deck && (
                  <TextView as="p" textStyle={TextStyle.BODY2}>
                    {deck.title}
                  </TextView>
                )}
                <LinkBadge connected={connected} />
              </>
            )}

            {playing && card && (
              <>
                <Eyebrow>{card.category}</Eyebrow>
                <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
                  {card.word}
                </TextView>
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
                <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
                  Round over
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
