import React, { createContext, useContext, useEffect, useState } from 'react';
import type { CallManager, ManagerState } from '../CallManager';
import type { CallEngine, EngineState } from '../CallEngine';
import type { CallPeopleDirectory } from '../ports';
import { IncomingOverlays } from './IncomingOverlays';
import { CallScreen } from './CallScreen';

interface Ctx {
  manager: CallManager;
  people: CallPeopleDirectory;
}
const CallCtx = createContext<Ctx | null>(null);

/**
 * Wrap the app once. Shows incoming rings, incoming device switches and the
 * full-screen call UI on top of whatever is underneath.
 */
export function CallProvider({
  manager,
  people,
  children,
}: Ctx & { children: React.ReactNode }) {
  const state = useManagerState(manager);
  return (
    <CallCtx.Provider value={{ manager, people }}>
      {children}
      {state.engine ? <CallScreen engine={state.engine} /> : null}
      <IncomingOverlays />
    </CallCtx.Provider>
  );
}

export function useCalls(): Ctx {
  const c = useContext(CallCtx);
  if (!c) throw new Error('useCalls must be used inside <CallProvider>');
  return c;
}

export function useManagerState(manager: CallManager): ManagerState {
  const [s, setS] = useState(manager.state);
  useEffect(() => manager.subscribe(setS), [manager]);
  return s;
}

export function useEngineState(engine: CallEngine): EngineState {
  const [s, setS] = useState(engine.state);
  useEffect(() => engine.subscribe(setS), [engine]);
  return s;
}
