import type { ChatReachMode, CountryLinqaCatalog, CountryLinqaPreferences, DiscoveryMode, InboundReach } from "./countrylinqa.service";

export type ActivationStep = "WELCOME" | "COUNTRY" | "DISCOVERY" | "DISCOVERABILITY" | "CHAT" | "READY";
export const ACTIVATION_STEPS: ActivationStep[] = ["WELCOME", "COUNTRY", "DISCOVERY", "DISCOVERABILITY", "CHAT", "READY"];

/** What the user picked on the three reach screens. Everything defaults to their own country. */
export interface ActivationChoices {
  discovery: DiscoveryMode;
  discoveryCountries: string[];
  discoverability: InboundReach;
  discoverabilityCountries: string[];
  chat: ChatReachMode;
  chatCountries: string[];
}

export const defaultChoices = (): ActivationChoices => ({
  discovery: "MY_COUNTRY", discoveryCountries: [], discoverability: "MY_COUNTRY", discoverabilityCountries: [], chat: "MY_COUNTRY", chatCountries: []
});

export interface ReachOption<K extends string> { key: K; label: string; detail: string; tier: "FREE" | "PREMIUM" | "ELITE" }

const own = (country: string | null, region: string | null) => ({
  country: country ?? "your country",
  region: region ?? "your region"
});

/** The option lists for the three reach screens, labelled with the user's own country and region. */
export function reachOptions(country: string | null, region: string | null) {
  const o = own(country, region);
  const discovery: Array<ReachOption<DiscoveryMode>> = [
    { key: "MY_COUNTRY", label: "My Country", detail: o.country, tier: "FREE" },
    { key: "SELECTED_COUNTRIES", label: "Selected Countries", detail: "Choose countries you want to explore", tier: "PREMIUM" },
    { key: "REGION", label: "My Region", detail: o.region, tier: "PREMIUM" },
    { key: "GLOBAL", label: "Worldwide", detail: "Explore globally", tier: "ELITE" }
  ];
  const discoverability: Array<ReachOption<InboundReach>> = [
    { key: "MY_COUNTRY", label: "My Country", detail: o.country, tier: "FREE" },
    { key: "SELECTED_COUNTRIES", label: "Selected Countries", detail: "Choose who can find you", tier: "PREMIUM" },
    { key: "REGION", label: "My Region", detail: o.region, tier: "PREMIUM" },
    { key: "GLOBAL", label: "Worldwide", detail: "Anyone can find you", tier: "ELITE" },
    { key: "CONTACTS_ONLY", label: "Existing Contacts Only", detail: "No new discovery", tier: "FREE" }
  ];
  const chat: Array<ReachOption<ChatReachMode>> = [
    { key: "MY_COUNTRY", label: "My Country", detail: o.country, tier: "FREE" },
    { key: "SELECTED_COUNTRIES", label: "Selected Countries", detail: "Choose who can message you", tier: "PREMIUM" },
    { key: "REGION", label: "My Region", detail: o.region, tier: "PREMIUM" },
    { key: "WORLDWIDE", label: "Worldwide", detail: "Anyone can start a chat", tier: "ELITE" },
    { key: "EXISTING_CONTACTS_ONLY", label: "Existing Contacts Only", detail: "Only your contacts", tier: "FREE" },
    { key: "NOBODY", label: "Nobody", detail: "No new chats", tier: "FREE" }
  ];
  return { discovery, discoverability, chat };
}

/** The message to show when a screen can not move on yet, or null when it can. */
export function stepError(step: ActivationStep, choices: ActivationChoices, prefs: Pick<CountryLinqaPreferences, "verifiedCountryCode" | "verificationState">): string | null {
  if (step === "COUNTRY" && (!prefs.verifiedCountryCode || prefs.verificationState !== "VERIFIED")) return "Confirm your country to continue.";
  if (step === "DISCOVERY" && choices.discovery === "SELECTED_COUNTRIES" && choices.discoveryCountries.length === 0) return "Choose at least one country.";
  if (step === "DISCOVERABILITY" && choices.discoverability === "SELECTED_COUNTRIES" && choices.discoverabilityCountries.length === 0) return "Choose at least one country.";
  if (step === "CHAT" && choices.chat === "SELECTED_COUNTRIES" && choices.chatCountries.length === 0) return "Choose at least one country.";
  return null;
}

/** The save request for the Ready screen. "My Region" means the region the user's own country is in. */
export function activationPayload(choices: ActivationChoices, prefs: Pick<CountryLinqaPreferences, "version">, ownRegion: string | null) {
  const regionFor = (mode: string) => (mode === "REGION" && ownRegion ? [ownRegion] : []);
  return {
    mode: choices.discovery,
    selectedCountries: choices.discovery === "SELECTED_COUNTRIES" ? choices.discoveryCountries : [],
    selectedRegions: regionFor(choices.discovery),
    inboundReach: choices.discoverability,
    inboundSelectedCountries: choices.discoverability === "SELECTED_COUNTRIES" ? choices.discoverabilityCountries : [],
    inboundSelectedRegions: regionFor(choices.discoverability),
    chatReach: {
      mode: choices.chat,
      ...(choices.chat === "SELECTED_COUNTRIES" ? { selectedCountries: choices.chatCountries } : {}),
      ...(choices.chat === "REGION" && ownRegion ? { regionCode: ownRegion } : {})
    },
    activate: true as const,
    expectedVersion: prefs.version
  };
}

const LABEL: Record<string, string> = {
  MY_COUNTRY: "My Country", SELECTED_COUNTRIES: "Selected Countries", REGION: "My Region", GLOBAL: "Worldwide", WORLDWIDE: "Worldwide",
  CONTACTS_ONLY: "Existing Contacts", EXISTING_CONTACTS_ONLY: "Existing Contacts", NOBODY: "Nobody"
};

/** The three rows on the Ready screen. */
export function activationSummary(choices: ActivationChoices): Array<{ label: string; value: string }> {
  return [
    { label: "Discovery", value: LABEL[choices.discovery] ?? choices.discovery },
    { label: "Discover Me", value: LABEL[choices.discoverability] ?? choices.discoverability },
    { label: "Chat Me", value: LABEL[choices.chat] ?? choices.chat }
  ];
}

export function regionOfCountry(catalog: CountryLinqaCatalog, countryCode: string | null): { code: string | null; name: string | null } {
  const country = catalog.countries.find((c) => c.code === countryCode);
  const region = catalog.regions.find((r) => r.code === country?.regionCode);
  return { code: region?.code ?? null, name: region?.name ?? null };
}

export type ChatAccessOutcome =
  | { kind: "UNAVAILABLE"; title: string; message: string }
  | { kind: "VERIFY"; title: string; message: string }
  | { kind: "RETRY"; title: string; message: string };

const UNAVAILABLE = "This person isn't accepting new chat requests from your current CountryLinqa reach.";

/**
 * What the Chat Access Result screen says when a chat could not start. Everything that comes from
 * the other person's settings, a block or a restriction reads the same, so the words never reveal
 * which of them it was. Only your own unverified country, and a connection problem, say something different.
 */
export function chatAccessOutcome(code: string | undefined): ChatAccessOutcome {
  if (code === "COUNTRY_NOT_ALLOWED" || code === "CONTACTS_ONLY" || code === "CHAT_REQUESTS_DISABLED") return { kind: "UNAVAILABLE", title: "Chat unavailable", message: UNAVAILABLE };
  if (code === "COUNTRY_UNVERIFIED") return { kind: "VERIFY", title: "Confirm your country", message: "Country verification is required before starting a new chat." };
  if (code === "NETWORK" || (code?.startsWith("HTTP_") && code !== "HTTP_403" && code !== "HTTP_404" && code !== "HTTP_422")) return { kind: "RETRY", title: "Could not check", message: "Check your connection and try again." };
  return { kind: "UNAVAILABLE", title: "Chat unavailable", message: "You can't start this conversation." };
}

/** One line for places that show a message inline. */
export function chatStartError(code?: string): string {
  return chatAccessOutcome(code).message;
}
