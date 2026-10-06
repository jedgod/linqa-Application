import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CountryLinqaService, type CountryCollection, type CountryItem, type CountrySearch, type CountryPagination, type CountryLinqaPreferences, type CountryLinqaCatalog, type SavedCountrySearch, type CountryNotificationPreferences, type CountryNotification, type CountryConnection, type CountryProfile, type CountrySecurityEvent } from "../../../mobile/services/countrylinqa.service";
import "./countrylinqa.css";
import { CountryLinqaDiscoverySettings } from "./CountryLinqaDiscoverySettings";

const collections: Array<{ kind: CountryCollection; title: string }> = [{ kind: "feed", title: "World" }, { kind: "people", title: "People" }, { kind: "events", title: "Events" }, { kind: "businesses", title: "Businesses" }, { kind: "communities", title: "Communities" }];
type Panel = CountryCollection | "settings" | "saved" | "notifications" | "connections" | "create" | "profile" | "security" | "report" | "plans" | "success";
const notificationLabels = { countryTrends: "Country trends", regionalTrends: "Regional trends", selectedCountryActivity: "Selected country activity", countryEvents: "Events", countryBusinesses: "Businesses", securityAlerts: "Security alerts" } as const;
export function CountryLinqaPage({ apiBaseUrl, accessToken, onClose }: { apiBaseUrl: string; accessToken: string; onClose: () => void }) {
  const currentIdentity = useRef({ apiBaseUrl, accessToken });
  currentIdentity.current = { apiBaseUrl, accessToken };
  const client = useMemo(() => new CountryLinqaService(apiBaseUrl, async () => accessToken,
    () => currentIdentity.current.apiBaseUrl === apiBaseUrl && currentIdentity.current.accessToken === accessToken), [apiBaseUrl, accessToken]);
  const [panel, setPanel] = useState<Panel>("feed");
  const [settingsVisit, setSettingsVisit] = useState(0);
  const [kind, setKind] = useState<CountryCollection>("feed");
  const [prefs, setPrefs] = useState<CountryLinqaPreferences | null>(null);
  const [draft, setDraft] = useState<CountryLinqaPreferences | null>(null);
  const [catalog, setCatalog] = useState<CountryLinqaCatalog>({ countries: [], regions: [] });
  const [filters, setFilters] = useState<CountrySearch>({}); const [search, setSearch] = useState<CountrySearch>({});
  const [items, setItems] = useState<CountryItem[]>([]); const [page, setPage] = useState<CountryPagination | null>(null);
  const [period, setPeriod] = useState<"all" | "week" | "month">("all"); const [mine, setMine] = useState(false);
  const [saved, setSaved] = useState<SavedCountrySearch[]>([]); const [searchName, setSearchName] = useState("");
  const [notifications, setNotifications] = useState<CountryNotification[]>([]); const [notificationPrefs, setNotificationPrefs] = useState<CountryNotificationPreferences | null>(null);
  const [connections, setConnections] = useState<CountryConnection[]>([]);
  const [profile, setProfile] = useState<CountryProfile | null>(null); const [securityEvents, setSecurityEvents] = useState<CountrySecurityEvent[]>([]);
  const [expectedCountry, setExpectedCountry] = useState("");
  const [reportTarget, setReportTarget] = useState<{ subjectId: string; subjectType: "USER" | "POST" | "EVENT" | "BUSINESS" } | null>(null);
  const [reportReason, setReportReason] = useState<"SPAM" | "FRAUD" | "ABUSE" | "OTHER">("SPAM"); const [reportDetails, setReportDetails] = useState("");
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [reload, setReload] = useState(0);
  const [createType, setCreateType] = useState<"post" | "event">("post"); const [body, setBody] = useState(""); const [startsAt, setStartsAt] = useState(""); const [city, setCity] = useState("");
  const version = useRef(0); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; version.current++; }; }, []);
  useEffect(() => {
    let current = true; setPrefs(null); setDraft(null); setItems([]); setSaved([]); setConnections([]); setNotifications([]); setNotificationPrefs(null); setProfile(null); setSecurityEvents([]); setError("");
    Promise.all([client.preferences(), client.catalog()]).then(([value, nextCatalog]) => { if (current) { setPrefs(value); setDraft(value); setCatalog(nextCatalog); } }).catch(cause => { if (current) setError(cause.message); });
    return () => { current = false; };
  }, [client, reload]);
  const queryKey = JSON.stringify({ ...filters, period, joinedOnly: kind === "communities" && mine });
  const loadCollection = useCallback(async (next?: CountryPagination) => {
    const request = next ? version.current : ++version.current;
    setLoading(true); setError(""); if (!next) { setItems([]); setPage(null); }
    try {
      const result = await client.collection(kind, JSON.parse(queryKey), next);
      if (!mounted.current || request !== version.current) return;
      setItems(old => next ? [...old, ...result.items.filter(item => !old.some(existing => existing.id === item.id))] : result.items);
      setPage(result.nextCursor ? { cursor: result.nextCursor } : typeof result.nextOffset === "number" ? { offset: result.nextOffset } : null);
    } catch (cause) { if (mounted.current && request === version.current) setError(cause instanceof Error ? cause.message : "Unable to load CountryLinqa"); }
    finally { if (mounted.current && request === version.current) setLoading(false); }
  }, [client, kind, queryKey]);
  useEffect(() => {
    if (collections.some(item => item.kind === panel)) { void loadCollection(); return () => { version.current++; }; }
    let current = true; version.current++; setLoading(true); setError(""); setNotice("");
    const request = panel === "saved" ? client.savedSearches().then(result => { if (current) setSaved(result.items); })
      : panel === "profile" ? client.profile().then(value => { if (current) setProfile(value); })
      : panel === "security" ? client.securityActivity().then(value => { if (current) setSecurityEvents(value.items); })
      : panel === "connections" ? client.connections().then(result => { if (current) setConnections(result.items); })
      : panel === "notifications" ? Promise.all([client.notificationPreferences(), client.notifications()]).then(([value, result]) => { if (current) { setNotificationPrefs(value); setNotifications(result.items); } }) : Promise.resolve();
    request.catch(cause => { if (current) setError(cause.message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [client, panel, loadCollection, reload]);
  async function act(work: () => Promise<void>) {
    setBusy(true); setError(""); setNotice(""); const request = version.current;
    try { await work(); return true; } catch (cause) { if (mounted.current && request === version.current) setError(cause instanceof Error ? cause.message : "Unable to complete action"); return false; }
    finally { if (mounted.current) setBusy(false); }
  }
  function open(next: Panel) { setPanel(next); setSettingsVisit(value => value + 1); setNotice(""); setError(""); if (collections.some(item => item.kind === next)) setKind(next as CountryCollection); }
  const isCollection = collections.some(item => item.kind === panel);
  return <main className="countrylinqa-app">
    <header className="countrylinqa-heading"><div><span className="countrylinqa-kicker">COUNTRYLINQA</span><h1>Linqa World</h1><p>Connect Locally. Connect Globally.</p></div><button onClick={onClose}>Back to chats</button></header>
    <fieldset className="countrylinqa-navigation" disabled={busy}><nav aria-label="CountryLinqa pages">{collections.map(item => <button key={item.kind} aria-current={panel === item.kind ? "page" : undefined} onClick={() => open(item.kind)}>{item.title}</button>)}<button onClick={() => open("saved")}>Saved searches</button><button onClick={() => open("connections")}>Connections</button><button onClick={() => open("notifications")}>Notifications</button><button onClick={() => open("settings")}>Discovery settings</button><button onClick={() => open("plans")}>Plans</button><button onClick={() => open("profile")}>My profile</button><button onClick={() => open("security")}>Security</button></nav></fieldset>
    {prefs && <aside className="countrylinqa-summary"><strong>{prefs.verifiedCountryCode ?? "Country confirmation required"}</strong><span>{prefs.verificationState.replace(/_/g, " ")} · {prefs.mode.replace(/_/g, " ")}{prefs.paused ? " · Paused" : ""}</span><span>{prefs.subscriptionTier} plan</span></aside>}
    {error && <div className="countrylinqa-error" role="alert">{error.replace(/_/g, " ")} <button onClick={() => setReload(value => value + 1)}>Try again</button></div>}
    {notice && <p role="status">{notice}</p>}
    {isCollection && <>
      <form className="countrylinqa-filters" onSubmit={event => { event.preventDefault(); setFilters(search); }}>
        <label>Search<input value={search.q ?? ""} maxLength={100} onChange={event => setSearch({ ...search, q: event.target.value })} placeholder={kind === "people" ? "Search people" : `Search ${kind}`} /></label>
        <label>Country<select value={search.country ?? ""} onChange={event => setSearch({ ...search, country: event.target.value })}><option value="">Any in my scope</option>{catalog.countries.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
        {kind !== "feed" && <label>Region<select value={search.region ?? ""} onChange={event => setSearch({ ...search, region: event.target.value })}><option value="">Any in my scope</option>{catalog.regions.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>}
        {kind === "people" && <><label>Language code<input maxLength={32} value={search.language ?? ""} onChange={event => setSearch({ ...search, language: event.target.value })} /></label><label className="countrylinqa-toggle"><input type="checkbox" checked={search.verifiedOnly ?? true} onChange={event => setSearch({ ...search, verifiedOnly: event.target.checked })} />Verified only</label></>}
        <button className="countrylinqa-primary" type="submit">Search</button><button type="button" onClick={() => { setSearch({}); setFilters({}); }}>Reset</button>
      </form>
      {kind === "events" && <div className="countrylinqa-actions">{(["all", "week", "month"] as const).map(value => <button key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{value === "all" ? "For you" : value === "week" ? "Next 7 days" : "Next month"}</button>)}</div>}
      {kind === "communities" && <label className="countrylinqa-toggle"><input type="checkbox" checked={mine} onChange={event => setMine(event.target.checked)} />My communities</label>}
      {(kind === "feed" || kind === "events") && <button disabled={busy} className="countrylinqa-primary" onClick={() => { setCreateType(kind === "events" ? "event" : "post"); open("create"); }}>Create {kind === "events" ? "event" : "post"}</button>}
      <div className="countrylinqa-grid">{items.filter(item => kind !== "communities" || !mine || item.joined).map(item => <article key={item.id}>
        <h2>{item.title}</h2><p>{item.detail}</p>{item.startsAt && <time>{new Date(item.startsAt).toLocaleString()}</time>}{item.createdAt && <time>{new Date(item.createdAt).toLocaleString()}</time>}
        {kind === "communities" && <button disabled={busy || item.suspended} onClick={() => void act(async () => { if (item.joined) await client.leaveCountryCommunity(item.id); else await client.joinCountryCommunity(item.id); await loadCollection(); })}>{item.suspended ? "Membership suspended" : item.joined ? "Leave community" : "Join community"}</button>}
        {kind === "people" && <button disabled={busy || item.connectionStatus === "ACCEPTED" || (item.connectionStatus === "PENDING" && !item.connectionIncoming)} onClick={() => item.connectionIncoming ? open("connections") : void act(async () => { await client.connect(item.id); await loadCollection(); })}>{item.connectionStatus === "ACCEPTED" ? "Connected" : item.connectionStatus === "PENDING" ? item.connectionIncoming ? "Respond to request" : "Request sent" : "Connect"}</button>}
        {kind !== "communities" && <button disabled={busy} onClick={() => { setReportTarget({ subjectId: item.id, subjectType: kind === "people" ? "USER" : kind === "feed" ? "POST" : kind === "events" ? "EVENT" : "BUSINESS" }); setReportDetails(""); setReportReason("SPAM"); open("report"); }}>Report</button>}
      </article>)}</div>
      {!loading && !error && items.filter(item => kind !== "communities" || !mine || item.joined).length === 0 && <p>No results yet. Try another search or change your discovery settings.</p>}
      {page && <button disabled={loading || busy} onClick={() => void loadCollection(page)}>Load more</button>}
      {kind === "people" && <form className="countrylinqa-filters" onSubmit={event => { event.preventDefault(); void act(async () => { await client.saveSearch(searchName.trim(), filters); setNotice("Search saved"); }); }}><label>Save this search<input maxLength={80} value={searchName} onChange={event => setSearchName(event.target.value)} placeholder="Search name" /></label><button disabled={busy || !searchName.trim()}>Save search</button></form>}
    </>}
    {panel === "saved" && <section><h2>Saved People Searches</h2>{saved.map(item => <article key={item.id}><h3>{item.name}</h3><p>{[item.filters.q, item.filters.country, item.filters.region, item.filters.language].filter(Boolean).join(" · ") || "My discovery scope"}</p><button onClick={() => { setSearch(item.filters); setFilters(item.filters); open("people"); }}>Run search</button><button disabled={busy} onClick={() => void act(async () => { await client.deleteSavedSearch(item.id); setSaved(old => old.filter(row => row.id !== item.id)); })}>Delete</button></article>)}{!loading && !saved.length && <p>No saved searches yet.</p>}</section>}
    {panel === "connections" && <section><h2>Connections</h2>{connections.map(item => <article key={item.id}><h3>{item.displayName}</h3><p>{item.status === "ACCEPTED" ? "Connected" : item.incoming ? "Wants to connect with you" : "Request sent"}</p>{item.status === "PENDING" && (item.incoming ? ["ACCEPT", "DECLINE"] as const : ["CANCEL"] as const).map(action => <button key={action} disabled={busy} onClick={() => void act(async () => { await client.resolveConnection(item.id, action); setConnections((await client.connections()).items); })}>{action}</button>)}</article>)}{!loading && !connections.length && <p>No connection requests yet.</p>}</section>}
    {(panel === "settings" || panel === "plans" || panel === "success") && prefs && draft && <CountryLinqaDiscoverySettings key={`${panel}-${settingsVisit}`} initialScreen={panel} preferences={prefs} draft={draft} catalog={catalog} busy={busy} onChange={setDraft} onSave={value => act(async () => {
      const next = await client.savePreferences({ ...value, selectedCountries: value.mode === "SELECTED_COUNTRIES" ? value.selectedCountries : [], selectedRegions: value.mode === "REGION" ? value.selectedRegions : [], inboundSelectedCountries: value.inboundReach === "SELECTED_COUNTRIES" ? value.inboundSelectedCountries : [], inboundSelectedRegions: value.inboundReach === "REGION" ? value.inboundSelectedRegions : [], locationPrecision: value.showCity ? "CITY" : value.showState ? "STATE" : "COUNTRY" });
      setPrefs(next); setDraft(next); setNotice("Discovery settings saved");
    })} onRefresh={() => act(async () => {
      const next = await client.preferences(); setPrefs(next); setDraft(next);
      if (next.subscriptionTier === "FREE") setNotice("No Premium or Elite entitlement is active yet."); else open("success");
    }).then(() => undefined)} />}
    {panel === "notifications" && <section><h2>Notifications</h2>{notificationPrefs && <form className="countrylinqa-settings" onSubmit={event => { event.preventDefault(); void act(async () => { setNotificationPrefs(await client.saveNotificationPreferences(notificationPrefs)); setNotice("Notification preferences saved"); }); }}>{Object.entries(notificationLabels).map(([key,label]) => { const typedKey = key as keyof typeof notificationLabels; return <label className="countrylinqa-toggle" key={key}><input type="checkbox" checked={notificationPrefs[typedKey]} onChange={event => setNotificationPrefs({ ...notificationPrefs, [typedKey]: event.target.checked })} />{label}</label>; })}<label>Digest frequency<select value={notificationPrefs.digestFrequency} onChange={event => setNotificationPrefs({ ...notificationPrefs, digestFrequency: event.target.value as CountryNotificationPreferences["digestFrequency"] })}>{["OFF", "DAILY", "WEEKLY"].map(value => <option key={value}>{value}</option>)}</select></label><button disabled={busy}>Save preferences</button></form>}<h3>Recent delivered alerts</h3>{notifications.map(item => <article key={item.id}><h3>{String(item.payload.title ?? item.notificationType).replace(/_/g, " ")}</h3>{typeof item.payload.body === "string" && <p>{item.payload.body}</p>}<time>{new Date(item.createdAt).toLocaleString()}</time></article>)}{!loading && !notifications.length && <p>No delivered CountryLinqa alerts yet.</p>}</section>}
    {panel === "create" && <form className="countrylinqa-settings" onSubmit={event => { event.preventDefault(); void act(async () => { if (createType === "event") { const date = new Date(startsAt); if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new Error("Choose a future event date"); await client.createEvent({ title: body.trim(), startsAt: date.toISOString(), ...(city.trim() ? { city: city.trim() } : {}) }); } else await client.createPost(body.trim()); setBody(""); open(createType === "event" ? "events" : "feed"); }); }}><h2>Create {createType}</h2><label>{createType === "event" ? "Event title" : "Post"}<textarea required maxLength={createType === "event" ? 200 : 5000} value={body} onChange={event => setBody(event.target.value)} /></label>{createType === "event" && <><label>Starts at<input required type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label><label>City (optional)<input maxLength={120} value={city} onChange={event => setCity(event.target.value)} /></label></>}<p>Your verified country and audience settings determine where this appears.</p><button className="countrylinqa-primary" disabled={busy || !body.trim()}>Publish</button></form>}
    {panel === "profile" && profile && <form className="countrylinqa-settings" onSubmit={event => { event.preventDefault(); void act(async () => { setProfile(await client.saveProfile({ displayName: profile.displayName.trim(), bio: profile.bio.trim() })); setNotice("Profile saved"); }); }}><h2>My Profile</h2><p>{profile.verifiedCountryCode ?? "Country unconfirmed"} · {profile.verificationState.replace(/_/g," ")}</p><label>Display name<input maxLength={100} required value={profile.displayName} onChange={event => setProfile({ ...profile,displayName: event.target.value })} /></label><label>About me<textarea maxLength={500} value={profile.bio} onChange={event => setProfile({ ...profile,bio: event.target.value })} /></label><button className="countrylinqa-primary" disabled={busy || !profile.displayName.trim()}>Save profile</button></form>}
    {panel === "security" && <section><h2>Country Identity and Security</h2><p>Discovery settings do not change your verified identity. A country change may require additional authentication and a review.</p><form className="countrylinqa-settings" onSubmit={event => { event.preventDefault(); void act(async () => { await client.requestCountryClarification(expectedCountry || undefined); setNotice("Country review requested"); }); }}><label>Expected country (optional)<select value={expectedCountry} onChange={event => setExpectedCountry(event.target.value)}><option value="">Ask for a review</option>{catalog.countries.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label><button disabled={busy}>Request country review</button></form><h3>Recent security activity</h3>{securityEvents.map(item => <article key={item.id}><h3>{item.eventType.replace(/_/g," ")}</h3><p>{item.severity}</p><time>{new Date(item.createdAt).toLocaleString()}</time></article>)}{!loading && !securityEvents.length && <p>No recent CountryLinqa security activity.</p>}</section>}
    {panel === "report" && reportTarget && <form className="countrylinqa-settings" onSubmit={event => { event.preventDefault(); void act(async () => { await client.report({ ...reportTarget,reason: reportReason,details: reportDetails }); setReportTarget(null); open(kind); setNotice("Report submitted to moderation"); }); }}><h2>Report to Moderation</h2><label>Reason<select value={reportReason} onChange={event => setReportReason(event.target.value as typeof reportReason)}>{["SPAM","FRAUD","ABUSE","OTHER"].map(value => <option key={value}>{value}</option>)}</select></label><label>Details (optional)<textarea maxLength={1000} value={reportDetails} onChange={event => setReportDetails(event.target.value)} /></label><button className="countrylinqa-primary" disabled={busy}>Submit report</button></form>}
    {(loading || (!prefs && !error)) && <p role="status">Loading CountryLinqa…</p>}
  </main>;
}
