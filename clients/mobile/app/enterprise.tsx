import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Banner, Empty, failureText, Loading, Screen, useKit } from "../components/workspace/kit";
import { useWorkspace } from "../services/use-workspace";
import type { AuditEntry, DirectoryEntry, Organization, OrganizationDetail, OrgPolicy } from "../services/workspace.service";
import { canSeeAudit, policyValueText, roleLabel } from "../services/workspace-model";
import { fonts, radius, type Palette } from "../theme/tokens";

type Tab = "people" | "policies" | "audit";

/**
 * Business. A read-only view of the organizations this account belongs to: who is in them, which policies are enforced,
 * and (for admins) the audit log. Roles, policies and sign-in settings are managed by the organization's admin, not here.
 */
export default function EnterpriseScreen() {
  const router = useRouter();
  const ws = useWorkspace();
  const { colors, s } = useKit();
  const st = useMemo(() => styles(colors), [colors]);
  const [orgs, setOrgs] = useState<Organization[] | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrganizationDetail | null>(null);
  const [tab, setTab] = useState<Tab>("people");
  const [people, setPeople] = useState<DirectoryEntry[] | null>(null);
  const [policies, setPolicies] = useState<OrgPolicy[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const run = useRef(0);

  const close = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/linqa"));
  const back = () => { setOrgId(null); setDetail(null); setPeople(null); setPolicies(null); setAudit(null); setTab("people"); setError(""); };

  const loadOrgs = useCallback(async () => {
    if (!ws) return;
    const mine = ++run.current;
    setLoading(true); setError("");
    try {
      const items = await ws.organizations();
      if (mine !== run.current) return;
      setOrgs(items);
      if (items.length === 1) setOrgId(items[0]!.id);
    } catch (e) { if (mine === run.current) setError(failureText(e, "load your organizations")); }
    finally { if (mine === run.current) setLoading(false); }
  }, [ws]);
  useEffect(() => { back(); setOrgs(null); void loadOrgs(); return () => { run.current++; }; }, [loadOrgs]);

  useEffect(() => {
    if (!ws || !orgId) return;
    const mine = ++run.current;
    setLoading(true); setError("");
    ws.organization(orgId)
      .then((d) => { if (mine === run.current) setDetail(d); })
      .catch((e) => { if (mine === run.current) setError(failureText(e, "open this organization")); })
      .finally(() => { if (mine === run.current) setLoading(false); });
  }, [ws, orgId]);

  // Each tab loads the first time it is opened.
  useEffect(() => {
    if (!ws || !orgId || !detail) return;
    const mine = run.current;
    const fail = (e: unknown) => { if (mine === run.current) setError(failureText(e, "load this list")); };
    if (tab === "people" && !people) ws.directory(orgId).then((v) => mine === run.current && setPeople(v)).catch(fail);
    if (tab === "policies" && !policies) ws.policies(orgId).then((v) => mine === run.current && setPolicies(v)).catch(fail);
    if (tab === "audit" && !audit && canSeeAudit(detail.role)) ws.auditLog(orgId).then((v) => mine === run.current && setAudit(v)).catch(fail);
  }, [ws, orgId, detail, tab, people, policies, audit]);

  const manyOrgs = (orgs?.length ?? 0) > 1;

  if (!orgId) {
    return (
      <Screen title="Business" subtitle="Teams, policies and administration" onClose={close}>
        {loading || !orgs ? (error ? <Empty icon="business-outline" title="Couldn't load Business" copy={error} action={{ label: "Try again", onPress: () => void loadOrgs() }} /> : <Loading />) : !orgs.length ? (
          <Empty icon="business-outline" title="No organization yet" copy="Business shows the teams you belong to. Organizations are set up by your company's admin, who can add you." />
        ) : (
          <FlatList data={orgs} keyExtractor={(o) => o.id} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" accessibilityLabel={item.name} style={st.card} onPress={() => setOrgId(item.id)}>
                <View style={st.logo}><Ionicons name="business" size={18} color={colors.accent} /></View>
                <View style={{ flex: 1 }}><Text style={st.cardTitle}>{item.name}</Text><Text style={s.muted}>{roleLabel(item.role)}{item.status !== "ACTIVE" ? ` · ${roleLabel(item.status)}` : ""}</Text></View>
                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              </Pressable>
            )} />
        )}
      </Screen>
    );
  }

  const tabs: Array<[Tab, string]> = [["people", "People"], ["policies", "Policies"], ...(detail && canSeeAudit(detail.role) ? [["audit", "Audit log"] as [Tab, string]] : [])];
  const list = tab === "people" ? people : tab === "policies" ? policies : audit;

  return (
    <Screen title={detail?.name ?? "Organization"} subtitle={detail ? `${roleLabel(detail.role)} · ${detail.memberCount} ${detail.memberCount === 1 ? "member" : "members"} · ${detail.enforcedPolicyCount} ${detail.enforcedPolicyCount === 1 ? "policy" : "policies"} enforced` : undefined} onClose={manyOrgs ? back : close}>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {!detail ? <Loading /> : (
        <>
          <View style={st.tabs}>
            {tabs.map(([key, label]) => (
              <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} style={[st.tab, tab === key && st.tabOn]} onPress={() => { setError(""); setTab(key); }}>
                <Text style={[st.tabText, tab === key && st.tabTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          {!list ? <Loading /> : (
            <FlatList
              data={list as Array<DirectoryEntry | OrgPolicy | AuditEntry>}
              keyExtractor={(item, i) => ("userId" in item ? item.userId : item.id) ?? String(i)}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 30, gap: 8 }}
              ListEmptyComponent={<Text style={[s.muted, { textAlign: "center", marginTop: 24 }]}>{tab === "people" ? "No members to show." : tab === "policies" ? "No policies are set for this organization." : "No activity recorded yet."}</Text>}
              ListFooterComponent={<Text style={[s.muted, { textAlign: "center", marginTop: 10 }]}>Read-only. Roles, policies and sign-in settings are managed by your organization's admin.</Text>}
              renderItem={({ item }) => {
                if ("userId" in item) return (
                  <View style={st.card}><View style={st.avatar}><Text style={st.avatarText}>{(item.displayName ?? "?").slice(0, 1).toUpperCase()}</Text></View>
                    <View style={{ flex: 1 }}><Text style={st.cardTitle}>{item.displayName ?? "Member"}</Text><Text style={s.muted}>{roleLabel(item.role)}</Text></View></View>
                );
                if ("key" in item) return (
                  <View style={st.card}><Ionicons name={item.enforced ? "shield-checkmark" : "shield-outline"} size={20} color={item.enforced ? colors.accent : colors.textFaint} />
                    <View style={{ flex: 1 }}><Text style={st.cardTitle}>{item.key}</Text><Text style={s.muted}>{policyValueText(item.value)} · {item.enforced ? "Enforced" : "Not enforced"}</Text></View></View>
                );
                return (
                  <View style={st.card}><Ionicons name="document-text-outline" size={20} color={colors.textMuted} />
                    <View style={{ flex: 1 }}><Text style={st.cardTitle}>{item.eventType}</Text><Text style={s.muted}>{item.targetType ? `${item.targetType} · ` : ""}{new Date(item.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</Text></View></View>
                );
              }}
            />
          )}
        </>
      )}
    </Screen>
  );
}

const styles = (c: Palette) => StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, padding: 12 },
  cardTitle: { fontFamily: fonts.bold, fontSize: 14, color: c.text },
  logo: { width: 38, height: 38, borderRadius: 10, backgroundColor: c.bg, alignItems: "center", justifyContent: "center" },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.surfaceAlt, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: fonts.bold, fontSize: 14, color: c.text },
  tabs: { flexDirection: "row", gap: 6, paddingHorizontal: 16, marginBottom: 10 },
  tab: { borderWidth: 1, borderColor: c.border, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: c.surface },
  tabOn: { backgroundColor: c.accent, borderColor: c.accent },
  tabText: { fontFamily: fonts.medium, fontSize: 12.5, color: c.textMuted },
  tabTextOn: { fontFamily: fonts.bold, color: c.onAccent }
});
