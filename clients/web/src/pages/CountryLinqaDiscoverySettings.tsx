import { useState, type ReactNode } from "react";
import type { CountryLinqaCatalog, CountryLinqaPreferences, DiscoveryMode, InboundReach } from "../../../mobile/services/countrylinqa.service";

type Screen = "settings" | "countries" | "regions" | "worldwide" | "plans" | "success";
type Tier = CountryLinqaPreferences["subscriptionTier"];
const modeNames: Record<InboundReach, string> = { MY_COUNTRY: "My Country Only", SELECTED_COUNTRIES: "My Selected Countries", REGION: "My Region", GLOBAL: "Worldwide", CONTACTS_ONLY: "Existing Contacts Only" };
const modes: DiscoveryMode[] = ["MY_COUNTRY", "SELECTED_COUNTRIES", "REGION", "GLOBAL"];
const tierFor = (mode: DiscoveryMode) => mode === "GLOBAL" ? "ELITE" : mode === "MY_COUNTRY" ? "FREE" : "PREMIUM";

// Adapted from CountryLinqa_Discovery_Settings_1_to_6_FULL_UI. Identity,
// catalog, limits, persistence and entitlement confirmation stay server-owned.
export function CountryLinqaDiscoverySettings({ preferences, draft, catalog, initialScreen, busy, onChange, onSave, onRefresh }: {
  preferences: CountryLinqaPreferences; draft: CountryLinqaPreferences; catalog: CountryLinqaCatalog;
  initialScreen: "settings" | "plans" | "success"; busy: boolean;
  onChange: (value: CountryLinqaPreferences) => void;
  onSave: (value: CountryLinqaPreferences) => Promise<boolean>;
  onRefresh: () => Promise<void>;
}) {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [inbound, setInbound] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<Tier>(preferences.subscriptionTier === "ELITE" ? "ELITE" : "PREMIUM");
  const [validation, setValidation] = useState("");
  const countryName = (code: string) => catalog.countries.find(item => item.code === code)?.name ?? code;
  const regionName = (code: string) => catalog.regions.find(item => item.code === code)?.name ?? code;
  const change = (patch: Partial<CountryLinqaPreferences>) => onChange({ ...draft, ...patch });
  function navigate(next: Screen) { setScreen(next); setValidation(""); setSearch(""); }
  function choose(mode: InboundReach, incoming: boolean) {
    setInbound(incoming);
    if (mode === "SELECTED_COUNTRIES" || mode === "REGION") {
      setSelection(incoming ? mode === "REGION" ? draft.inboundSelectedRegions : draft.inboundSelectedCountries : mode === "REGION" ? draft.selectedRegions : draft.selectedCountries);
      navigate(mode === "REGION" ? "regions" : "countries");
    } else if (mode === "GLOBAL") navigate("worldwide");
    else change(incoming ? { inboundReach: mode } : { mode: mode as DiscoveryMode });
  }
  async function persist(value: CountryLinqaPreferences) { if (await onSave(value)) navigate("settings"); }
  function toggleLocation(key: "showCity" | "showState" | "showCountry", value: boolean) {
    change({ [key]: value, ...(key === "showCity" && value ? { showState: true, showCountry: true } : {}), ...(key === "showState" ? value ? { showCountry: true } : { showCity: false } : {}), ...(key === "showCountry" && !value ? { showState: false, showCity: false } : {}) });
  }
  const title = { settings: "Discovery Settings", countries: "Select Countries", regions: "Select Region", worldwide: "Worldwide", plans: "Premium Plans", success: preferences.subscriptionTier === "ELITE" ? "CountryLinqa Elite" : "CountryLinqa Premium" }[screen];
  const currentDetail = draft.mode === "MY_COUNTRY" ? countryName(preferences.verifiedCountryCode ?? "Country verification required") : draft.mode === "SELECTED_COUNTRIES" ? `${draft.selectedCountries.length} countries selected` : draft.mode === "REGION" ? draft.selectedRegions.map(regionName).join(", ") || "Choose a region" : "Worldwide discovery";
  const pickerMode = screen === "regions" ? "REGION" : "SELECTED_COUNTRIES";
  const limit = screen === "regions" ? preferences.selectionLimits.regions : preferences.selectionLimits.countries;
  const pickerAllowed = preferences.allowedModes[pickerMode];
  const rows = (screen === "regions" ? catalog.regions : catalog.countries).filter(item => `${item.name} ${item.code}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  return <section className="countrylinqa-discovery" aria-label={title}>
    <header className="cl-discovery-header">{screen !== "settings" && screen !== "success" ? <button disabled={busy} type="button" aria-label="Back to Discovery Settings" onClick={() => navigate("settings")}>‹</button> : <span />}<h2>{title}</h2><span /></header>
    <fieldset disabled={busy} className="cl-discovery-body">
      {screen === "settings" && <>
        <p className="cl-section-caption">Current Mode</p>
        <div className="cl-current-mode"><Globe /><div><strong>{modeNames[draft.mode]}</strong><small>{currentDetail}</small></div><button type="button" onClick={() => choose(draft.mode === "MY_COUNTRY" ? "SELECTED_COUNTRIES" : draft.mode, false)}>Change</button></div>
        <Group title="Who I can discover"><div className="cl-mode-options">{modes.map(mode => <button key={mode} type="button" aria-pressed={draft.mode === mode} onClick={() => choose(mode, false)}><span>{modeNames[mode]}</span>{tierFor(mode) !== "FREE" && <Badge elite={mode === "GLOBAL"}>{tierFor(mode)}{preferences.allowedModes[mode] ? "" : " · Locked"}</Badge>}</button>)}</div></Group>
        <Group title="Discovery Reach"><label className="cl-reach-row"><span>Who can discover me<small>Control inbound CountryLinqa reach.</small></span><select aria-label="Who can discover me" value={draft.inboundReach} onChange={event => choose(event.target.value as InboundReach, true)}>{[...modes, "CONTACTS_ONLY" as const].map(mode => <option key={mode} value={mode}>{modeNames[mode]}</option>)}</select></label>{draft.inboundReach === "SELECTED_COUNTRIES" || draft.inboundReach === "REGION" ? <button className="cl-inbound-edit" type="button" onClick={() => choose(draft.inboundReach, true)}>Edit inbound {draft.inboundReach === "REGION" ? "regions" : "countries"}</button> : null}<Toggle label="Verified users only" value={draft.verifiedOnly} onChange={value => change({ verifiedOnly: value })} /></Group>
        <Group title="Privacy"><Toggle label="Show city" value={draft.showCity} onChange={value => toggleLocation("showCity", value)} /><Toggle label="Show state or province" value={draft.showState} onChange={value => toggleLocation("showState", value)} /><Toggle label="Show country" value={draft.showCountry} onChange={value => toggleLocation("showCountry", value)} /></Group>
        <Group title="Recommendations"><Toggle label="Business discovery" value={draft.allowBusinesses} onChange={value => change({ allowBusinesses: value })} /><Toggle label="Community recommendations" value={draft.allowCommunities} onChange={value => change({ allowCommunities: value })} /><Toggle label="Event recommendations" value={draft.allowEvents} onChange={value => change({ allowEvents: value })} /></Group>
        <Group title="Advanced"><Toggle label="Pause discovery" detail="Stop new discovery but keep existing connections." value={draft.paused} onChange={value => change({ paused: value })} /></Group>
        <p className="cl-identity-note"><span aria-hidden="true">✓</span>Verified country identity is separate from reach controls.</p>
        <button className="countrylinqa-primary cl-full-button" type="button" onClick={() => void persist(draft)}>{busy ? "Saving…" : "Save changes"}</button>
      </>}
      {(screen === "countries" || screen === "regions") && <>
        <p className="cl-centered">Choose {screen === "regions" ? "regions" : "countries"} for {inbound ? "inbound" : "outbound"} discovery.{pickerAllowed ? ` Your plan allows up to ${limit}.` : " Premium or Elite access is required."}</p>
        {!pickerAllowed && <div className="cl-upgrade-note"><Badge>Premium</Badge><button type="button" onClick={() => navigate("plans")}>View plans</button></div>}
        <label className="cl-country-search">Search {screen === "regions" ? "regions" : "countries"}<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={screen === "regions" ? "Search regions" : "Search countries"} /></label>
        <div className="cl-selection-list">{rows.map(item => { const checked = selection.includes(item.code); return <label key={item.code} className={`cl-selection-row${checked ? " cl-selection-checked" : ""}`}>{screen === "countries" && <span className="cl-flag" aria-hidden="true">{flag(item.code)}</span>}<span className="cl-selection-name">{item.name}<small>{"callingCode" in item ? item.callingCode ?? item.code : item.code}</small></span><input type="checkbox" checked={checked} disabled={!pickerAllowed || (!checked && selection.length >= limit)} onChange={() => { setSelection(checked ? selection.filter(code => code !== item.code) : [...selection, item.code]); setValidation(""); }} /></label>; })}</div>
        {!rows.length && <p className="cl-centered">No {screen === "regions" ? "regions" : "countries"} match your search.</p>}
        <p className="cl-centered" role="status">{selection.length} {screen === "regions" ? "regions" : "countries"} selected</p>
        <button type="button" className="countrylinqa-primary cl-full-button" disabled={!pickerAllowed || selection.length === 0 || selection.length > limit} onClick={() => {
          if (!selection.length || selection.length > limit) { setValidation(`Select between 1 and ${limit}.`); return; }
          const patch = inbound ? screen === "regions" ? { inboundReach: "REGION" as const, inboundSelectedRegions: selection } : { inboundReach: "SELECTED_COUNTRIES" as const, inboundSelectedCountries: selection } : screen === "regions" ? { mode: "REGION" as const, selectedRegions: selection } : { mode: "SELECTED_COUNTRIES" as const, selectedCountries: selection };
          void persist({ ...draft, ...patch });
        }}>{busy ? "Saving…" : "Save selection"}</button>
      </>}
      {screen === "worldwide" && <div className="cl-hero"><div className="cl-globe-art"><Globe /><span className="cl-orbit cl-orbit-one" aria-hidden="true">✦</span><span className="cl-orbit cl-orbit-two" aria-hidden="true">✦</span></div><h3>Connect without borders</h3><p>Connect with eligible users worldwide while privacy rules remain enforced.</p>{!preferences.allowedModes.GLOBAL && <div className="cl-global-lock"><Badge elite>Elite</Badge><p>Worldwide discovery requires Elite.</p></div>}<button className="countrylinqa-primary cl-full-button" type="button" onClick={() => preferences.allowedModes.GLOBAL ? void persist({ ...draft, ...(inbound ? { inboundReach: "GLOBAL" } : { mode: "GLOBAL" }) }) : (setSelectedPlan("ELITE"), navigate("plans"))}>{preferences.allowedModes.GLOBAL ? busy ? "Saving…" : "Save preference" : "View Elite plan"}</button></div>}
      {screen === "plans" && <>
        <div className="cl-hero cl-plans-intro"><span className="cl-crown" aria-hidden="true">♛</span><h3>Unlock More Connections</h3><p>Compare discovery plans. Access is confirmed by your Linqa billing entitlement.</p></div>
        <div className="cl-plan-list">{(["FREE", "PREMIUM", "ELITE"] as const).map(tier => <button className="cl-plan-card" key={tier} type="button" aria-pressed={selectedPlan === tier} onClick={() => setSelectedPlan(tier)}><div className="cl-plan-top"><strong>{tier === "FREE" ? "Free" : tier === "PREMIUM" ? "Premium" : "Elite"}</strong>{tier === "PREMIUM" && <Badge>Popular</Badge>}{tier === "ELITE" && <Badge elite>Global</Badge>}<span>{preferences.subscriptionTier === tier ? "Active" : tier === "FREE" ? "$0" : "Billing managed"}</span></div><p>{tier === "FREE" ? "My Country only" : tier === "PREMIUM" ? "Selected countries and regional discovery" : "Worldwide discovery"}</p><ul>{(tier === "FREE" ? ["Verified country feed", "Basic discovery"] : tier === "PREMIUM" ? ["Selected countries", "Regional discovery", "Server-enforced selection limits"] : ["Worldwide discovery", "Country and regional controls", "Privacy-aware discovery"]).map(feature => <li key={feature}><span aria-hidden="true">✓</span>{feature}</li>)}</ul></button>)}</div>
        <p className="cl-centered">Choosing a card compares plans. Refresh after your billing change to confirm access.</p>
        <button className="countrylinqa-primary cl-full-button" type="button" onClick={() => void onRefresh()}>{busy ? "Refreshing…" : "Refresh plan access"}</button>
      </>}
      {screen === "success" && preferences.subscriptionTier !== "FREE" && <div className="cl-hero cl-success"><div className="cl-success-art" aria-hidden="true">♛<span>✓</span></div><h3>{preferences.subscriptionTier} access is active</h3><p>Your server-confirmed CountryLinqa discovery controls are ready.</p><button type="button" className="countrylinqa-primary cl-full-button" onClick={() => navigate("settings")}>Continue</button></div>}
      {validation && <p role="alert">{validation}</p>}
    </fieldset>
  </section>;
}

function Globe() { return <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="32" cy="32" r="27" /><ellipse cx="32" cy="32" rx="13" ry="27" /><path d="M5 32h54M10 17h44M10 47h44" /></svg>; }
function Group({ title, children }: { title: string; children: ReactNode }) { return <div className="cl-settings-group"><h3>{title}</h3><div className="cl-group-card">{children}</div></div>; }
function Badge({ children, elite }: { children: ReactNode; elite?: boolean }) { return <span className={`cl-badge${elite ? " cl-badge-elite" : ""}`}>{children}</span>; }
function Toggle({ label, detail, value, onChange }: { label: string; detail?: string; value: boolean; onChange: (value: boolean) => void }) { return <label className="cl-switch-row"><span>{label}{detail && <small>{detail}</small>}</span><input type="checkbox" role="switch" checked={value} onChange={event => onChange(event.target.checked)} /></label>; }
function flag(code: string) { return /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...Array.from(code, character => 127397 + character.charCodeAt(0))) : ""; }
