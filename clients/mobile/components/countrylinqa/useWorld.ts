import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import type { CountryCollection, CountryItem, CountryPagination } from "../../services/countrylinqa.service";
import { useCountryClient } from "../CountryLinqaUI";

/** The viewer's own country, region and name, for the "United States ⌄" line under page titles. */
export function useMyCountry() {
  const client = useCountryClient();
  const [me, setMe] = useState<{ code: string | null; name: string | null; region: string | null }>({ code: null, name: null, region: null });
  useEffect(() => {
    let active = true;
    Promise.all([client.preferences(), client.catalog()]).then(([prefs, catalog]) => {
      if (!active) return;
      const country = catalog.countries.find((c) => c.code === prefs.verifiedCountryCode);
      setMe({ code: prefs.verifiedCountryCode, name: country?.name ?? null, region: country?.regionCode ?? null });
    }, () => undefined);
    return () => { active = false; };
  }, [client]);
  return me;
}

type Filters = Parameters<ReturnType<typeof useCountryClient>["collection"]>[1];

/**
 * A paged list from one of the CountryLinqa collections. Only the newest request may change what is
 * shown, so quickly switching a tab or typing in search never mixes two lists together.
 */
export function useCollection(kind: CountryCollection, filters: Filters | null, key: string) {
  const client = useCountryClient();
  const [items, setItems] = useState<CountryItem[]>([]);
  const [page, setPage] = useState<CountryPagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const load = useCallback(async (next?: CountryPagination) => {
    const current = filtersRef.current;
    const mine = next ? generation.current : ++generation.current;
    setError(null);
    if (!current) { setItems([]); setPage(null); setLoading(false); return; }
    setLoading(true);
    if (!next) { setItems([]); setPage(null); }
    try {
      const result = await client.collection(kind, current, next);
      if (mine !== generation.current) return;
      setItems((old) => (next ? [...old, ...result.items.filter((i) => !old.some((o) => o.id === i.id))] : result.items));
      setPage(result.nextCursor ? { cursor: result.nextCursor } : typeof result.nextOffset === "number" ? { offset: result.nextOffset } : null);
    } catch (cause) {
      if (mine === generation.current) setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Unable to load");
    } finally { if (mine === generation.current) setLoading(false); }
  }, [client, kind]);

  useFocusEffect(useCallback(() => { void load(); return () => { generation.current++; }; }, [load, key]));
  return { items, setItems, page, loading, error, reload: () => load(), more: () => (page ? load(page) : Promise.resolve()) };
}
