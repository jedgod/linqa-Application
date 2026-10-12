import { useEffect, useState } from "react";
import { Directory, File, Paths } from "expo-file-system";

/**
 * The events and meetings this person has added to Linqa from chats: they show under Upcoming on Home and Calls, and the whole
 * list, past ones included, is the Event log. It is kept on this phone only (an event's title is sealed inside the chat message, so
 * the server never sees it). Adding the same event twice just updates it.
 */
export interface MyEvent {
  id: string;
  kind: "event" | "meeting";
  title: string;
  startsAt: string;
  endsAt: string;
  place?: string;
  note?: string;
  addedAt: string;
}

const FILE_NAME = "linqa-my-events.json";
const LIMIT = 500;
const listeners = new Set<() => void>();
let cache: MyEvent[] | null = null;

function storeFile(): File { return new File(new Directory(Paths.document), FILE_NAME); }

async function read(): Promise<MyEvent[]> {
  if (cache) return cache;
  try {
    const file = storeFile();
    const parsed = file.exists ? (JSON.parse(await file.text()) as unknown) : [];
    cache = Array.isArray(parsed) ? (parsed as MyEvent[]).filter((e) => e && typeof e.id === "string" && typeof e.title === "string" && !Number.isNaN(Date.parse(e.startsAt))) : [];
  } catch { cache = []; }
  return cache;
}

function write(items: MyEvent[]) {
  cache = items;
  try { const file = storeFile(); if (!file.exists) file.create(); file.write(JSON.stringify(items)); } catch { /* kept in memory until the next successful write */ }
  listeners.forEach((l) => l());
}

export async function listMyEvents(): Promise<MyEvent[]> { return [...(await read())].sort((a, b) => a.startsAt.localeCompare(b.startsAt)); }

export async function addMyEvent(event: Omit<MyEvent, "addedAt">): Promise<void> {
  const items = await read();
  const without = items.filter((e) => e.id !== event.id);
  const previous = items.find((e) => e.id === event.id);
  write([...without, { ...event, addedAt: previous?.addedAt ?? new Date().toISOString() }].slice(-LIMIT));
}

export async function removeMyEvent(id: string): Promise<void> { write((await read()).filter((e) => e.id !== id)); }

export async function isInMyEvents(id: string): Promise<boolean> { return (await read()).some((e) => e.id === id); }

/** The saved events (oldest first). Updates when something is added or removed. */
export function useMyEvents(): { items: MyEvent[]; loaded: boolean } {
  const [state, setState] = useState<{ items: MyEvent[]; loaded: boolean }>({ items: [], loaded: false });
  useEffect(() => {
    let live = true;
    const refresh = () => { void listMyEvents().then((items) => { if (live) setState({ items, loaded: true }); }); };
    refresh();
    listeners.add(refresh);
    return () => { live = false; listeners.delete(refresh); };
  }, []);
  return state;
}

/** Events that have not ended yet, soonest first. */
export const upcomingOf = (items: MyEvent[], now = Date.now()) => items.filter((e) => Date.parse(e.endsAt || e.startsAt) >= now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
