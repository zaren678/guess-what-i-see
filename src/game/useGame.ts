import {useCallback, useEffect, useSyncExternalStore} from 'react';
import {useLocation} from 'react-router-dom';
import {applyPublicAction, type PublicAction} from './actions';
import {
  attachCloud,
  getCloudSnapshot,
  subscribeCloud,
  type CloudRole,
} from './cloud';
import {dispatchGame, getGameState, subscribeGameState} from './store';

/**
 * Game access for pages. State lives in the module store (it must survive
 * route navigation, and the router shell cannot host a provider). The cloud
 * link is a page-load singleton shared by every page: both sides broadcast
 * local mutations and adopt the latest remote snapshot, so no laptop server
 * or relay is needed.
 */
export function useGame() {
  const location = useLocation();
  const role: CloudRole = location.pathname.startsWith('/teacher')
    ? 'teacher'
    : 'glasses';

  const state = useSyncExternalStore(subscribeGameState, getGameState);
  const cloud = useSyncExternalStore(subscribeCloud, getCloudSnapshot);

  useEffect(() => {
    attachCloud({
      role,
      onRemoteState: remote =>
        dispatchGame({type: 'APPLY_STATE', state: remote}),
    });
  }, [role]);

  const mutate = useCallback((action: PublicAction) => {
    applyPublicAction(action);
  }, []);

  return {
    role,
    state,
    mutate,
    connected: cloud.connected,
    room: cloud.room,
  };
}

// Re-exported so pages keep one import site for the action type.
export type {PublicAction};
export {dispatchGame};
