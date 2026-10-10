import { useMemo, useState } from "react";
import type { DiscoveryPolicy } from "./discoveryApi";

export function useDiscoveryDraft(initial:DiscoveryPolicy) {
  const [saved,setSaved] = useState(initial);
  const [draft,setDraft] = useState(initial);
  const [saving,setSaving] = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(saved) !== JSON.stringify(draft),
    [saved,draft]
  );

  async function persist(save:(p:DiscoveryPolicy)=>Promise<DiscoveryPolicy>) {
    if (!dirty || saving) return;
    setSaving(true);
    const snapshot = saved;
    try {
      const next = await save(draft);
      setSaved(next);
      setDraft(next);
    } catch (e) {
      setDraft(snapshot); // rollback optimistic draft
      throw e;
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setDraft(saved);
  }

  return {draft,setDraft,dirty,saving,persist,reset};
}
