// Keeps the whiteboard and the screen-annotation layer in sync over the
// session's encrypted data channel, plus live cursors / laser pointers and
// the presenter's "lock drawing" switch.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Board, Layer, Op, WireMessage } from "../whiteboard/model";
import { Peer } from "../whiteboard/WhiteboardCanvas";
import { LiveSession } from "./LiveSession";

const PRESENCE_MS = 66; // ~15 updates a second

export function useSharedBoards(session: LiveSession, selfId: string, selfName: string, peerName: string) {
  const boards = useMemo(() => ({ board: new Board(selfId), screen: new Board(selfId) }), [selfId]);
  const [peers, setPeers] = useState<Peer[]>([]);
  // Lock state: who locked, if anyone. When the other person locks, only they can draw.
  const [lockedBy, setLockedBy] = useState<string | null>(null);
  const lockRef = useRef<string | null>(null);
  lockRef.current = lockedBy;
  const lastPresence = useRef(0);

  useEffect(() => {
    const allow = (author: string) => !lockRef.current || lockRef.current === author;

    const offOpen = session.onChannelOpen(() => {
      // Late join or reconnect: send everything we have; the other side merges.
      session.send({ t: "sync", layer: "board", els: boards.board.snapshot() });
      session.send({ t: "sync", layer: "screen", els: boards.screen.snapshot() });
      if (lockRef.current === selfId) session.send({ t: "lock", locked: true, by: selfId });
    });

    const offWire = session.onWire((m: WireMessage, from) => {
      switch (m.t) {
        case "ops":
          if (Array.isArray(m.ops) && (m.layer === "board" || m.layer === "screen")) boards[m.layer].receive(m.ops.slice(0, 500), from, allow);
          break;
        case "sync":
          if (Array.isArray(m.els) && (m.layer === "board" || m.layer === "screen")) boards[m.layer].receiveSync(m.els);
          break;
        case "presence":
          if (typeof m.x === "number" && typeof m.y === "number" && Number.isFinite(m.x) && Number.isFinite(m.y)) {
            setPeers([{ id: from, name: peerName, color: "#1F5FA8", x: m.x, y: m.y, laser: !!m.laser, at: Date.now() }]);
          }
          break;
        case "lock":
          // Only the person who set a lock can lift it; m.by must be the sender.
          if (m.by !== from) break;
          if (m.locked) setLockedBy(from);
          else if (lockRef.current === from) setLockedBy(null);
          break;
      }
    });

    return () => {
      offOpen();
      offWire();
    };
  }, [session, boards, selfId, peerName]);

  // Peers' cursors fade after a few seconds without movement.
  useEffect(() => {
    if (!peers.length) return;
    const id = setTimeout(() => setPeers((p) => p.filter((x) => Date.now() - x.at < 5000)), 5200);
    return () => clearTimeout(id);
  }, [peers]);

  const sendOps = useCallback((layer: Layer) => (ops: Op[]) => session.send({ t: "ops", layer, ops }), [session]);

  const sendPointer = useCallback(
    (x: number, y: number, laser: boolean) => {
      const now = Date.now();
      if (now - lastPresence.current < PRESENCE_MS) return;
      lastPresence.current = now;
      session.send({ t: "presence", author: selfId, name: selfName, x, y, laser });
    },
    [session, selfId, selfName]
  );

  const setLocked = useCallback(
    (locked: boolean) => {
      if (lockRef.current && lockRef.current !== selfId) return; // can't override the other person's lock
      setLockedBy(locked ? selfId : null);
      session.send({ t: "lock", locked, by: selfId });
    },
    [session, selfId]
  );

  return {
    boards,
    peers,
    sendOps,
    sendPointer,
    lockedByMe: lockedBy === selfId,
    lockedByPeer: !!lockedBy && lockedBy !== selfId,
    setLocked,
  };
}
