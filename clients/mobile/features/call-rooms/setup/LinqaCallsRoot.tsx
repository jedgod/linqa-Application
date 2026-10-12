/**
 * Mount once, inside your signed-in tree:
 *
 *   // index.ts / app/_layout.tsx, FIRST import of the app:
 *   import 'react-native-get-random-values';
 *
 *   <LinqaCallsRoot
 *     session={{ apiBaseUrl, getToken, userId, deviceId, deviceName, platform }}
 *     core={linqaCoreBinding(LinqaCore)}   // see setup/linqaCoreAdapter.ts
 *     people={peopleDirectory}
 *   >
 *     <Stack />
 *   </LinqaCallsRoot>
 *
 * Remount (change `key`) when the user signs out or switches account.
 */
import React, { useEffect, useMemo } from 'react';
import { CallManager } from '../CallManager';
import { LinqaCallCrypto } from '../crypto/LinqaCallCrypto';
import { HttpKeyDirectory } from '../crypto/httpKeyDirectory';
import type { KeyDirectory, LinqaCoreBinding } from '../crypto/linqaCore';
import { setupCallSystem } from '../native/callSystem';
import type { CallPeopleDirectory, CallSession } from '../ports';
import { CallProvider } from '../ui/CallProvider';

export function LinqaCallsRoot({
  session,
  core,
  people,
  keyDirectory,
  children,
}: {
  session: CallSession;
  core: LinqaCoreBinding;
  people: CallPeopleDirectory;
  /** Defaults to HttpKeyDirectory against the API. */
  keyDirectory?: KeyDirectory;
  children: React.ReactNode;
}) {
  const manager = useMemo(() => {
    const directory = keyDirectory ?? new HttpKeyDirectory(session);
    const crypto = new LinqaCallCrypto(core, directory, { userId: session.userId, deviceId: session.deviceId });
    return new CallManager(session, crypto);
    // One manager per signed-in user + device.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.userId, session.deviceId, session.apiBaseUrl]);

  useEffect(() => {
    const off = setupCallSystem(manager, people);
    return () => {
      off();
      manager.dispose();
    };
  }, [manager]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <CallProvider manager={manager} people={people}>
      {children}
    </CallProvider>
  );
}
