import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { CallEngine, Route } from '../CallEngine';
import { callApi } from '../callApi';
import type { CallInfoRes } from '../protocol';
import { useCalls, useEngineState } from './CallProvider';
import { formatDuration, Icon, k, Sheet, theme, useNow } from './kit';

export function CallInfoSheet({
  visible,
  engine,
  onClose,
}: {
  visible: boolean;
  engine: CallEngine;
  onClose: () => void;
}) {
  const s = useEngineState(engine);
  const { manager, people } = useCalls();
  const [server, setServer] = useState<{ info: CallInfoRes; fetchedAt: number } | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const now = useNow(1000, visible);

  useEffect(() => {
    if (!visible) return;
    engine.refreshRoutes();
    engine.verificationCode().then(setCode);
    callApi
      .info(manager.session, s.callId)
      .then((info) => setServer({ info, fetchedAt: Date.now() }))
      .catch(() => setServer(null));
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Server time is the source of truth; tick it forward locally.
  const durationMs = server
    ? server.info.answeredAt
      ? server.info.durationMs + (server.info.endedAt ? 0 : now - server.fetchedAt)
      : 0
    : s.connectedAt
      ? now - s.connectedAt
      : 0;

  const route = engine.overallRoute();
  const peers = Object.values(s.peers);

  return (
    <Sheet visible={visible} onClose={onClose} title="Call info">
      <Row icon="lock" label="Encryption" value="End-to-end encrypted" />
      <Row
        icon={route === 'relay' ? 'shuffle' : 'git-commit'}
        label="Connection"
        value={routeText(route)}
        sub={
          route === 'relay'
            ? 'Media passes through a Linqa relay server because a direct path was blocked. The relay cannot decrypt it.'
            : route === 'direct'
              ? 'Media goes straight between devices.'
              : undefined
        }
      />
      <Row icon="clock" label="Duration" value={formatDuration(durationMs)} />
      <Row icon="users" label="In call" value={`${peers.length + 1} of ${server?.info.maxParticipants ?? 8}`} />

      {peers.length > 1 ? (
        <View style={{ marginTop: 8 }}>
          {peers.map((p) => (
            <Text key={p.participantId} style={[k.dim, { paddingVertical: 2 }]}>
              {people.displayName(p.userId)}: {routeText(p.route)}
            </Text>
          ))}
        </View>
      ) : null}

      {code ? (
        <View style={{ marginTop: 16, padding: 14, backgroundColor: theme.surfaceHi, borderRadius: 14 }}>
          <Text style={k.dim}>Security code</Text>
          <Text style={{ color: theme.text, fontSize: 22, letterSpacing: 3, fontWeight: '600', marginVertical: 6 }}>
            {code}
          </Text>
          <Text style={k.dim}>Everyone in this call sees the same code. Read it out loud to confirm no one is listening in.</Text>
        </View>
      ) : null}
    </Sheet>
  );
}

function Row({ icon, label, value, sub }: { icon: string; label: string; value: string; sub?: string }) {
  return (
    <View style={[k.listRow, { alignItems: 'flex-start' }]}>
      <Icon name={icon} color={theme.textDim} />
      <View style={{ flex: 1 }}>
        <Text style={k.dim}>{label}</Text>
        <Text style={[k.body, { fontVariant: ['tabular-nums'] }]}>{value}</Text>
        {sub ? <Text style={[k.dim, { marginTop: 4 }]}>{sub}</Text> : null}
      </View>
    </View>
  );
}

const routeText = (r: Route) => (r === 'relay' ? 'Relayed' : r === 'direct' ? 'Direct (peer to peer)' : 'Checking…');
