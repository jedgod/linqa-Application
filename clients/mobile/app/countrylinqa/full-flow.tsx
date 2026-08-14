import { type ReactNode } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

const purple = "#6558dc";
const purpleSoft = "#efeaff";
const text = "#1f2937";
const softText = "#5b6476";
const border = "#dfe5f0";
const bg = "#f4f5f8";
const shellBg = "#f5f6fa";

const FLAG_BY_NAME: Record<string, string> = {
  "United States": "🇺🇸",
  Canada: "🇨🇦",
  "United Kingdom": "🇬🇧",
  Ghana: "🇬🇭",
  Australia: "🇦🇺",
  Germany: "🇩🇪",
  France: "🇫🇷",
  Japan: "🇯🇵"
};

type ScreenModel = {
  id: string;
  label: string;
  title: string;
  variant: "welcome" | "verifyPhone" | "otp" | "countryDetected" | "discoveryScope" | "complete" | "discoverySettings" | "selectCountries" | "selectRegion" | "worldwide" | "premiumPlans" | "worldHome" | "people" | "events" | "businesses" | "communities";
  subtitle?: string[];
  primaryAction?: string;
  secondaryAction?: string;
  phone?: string;
  country?: string;
  countries?: Array<{ name: string; selected: boolean }>;
  regions?: string[];
  selectedRegion?: string;
  toggles?: Array<{ label: string; active: boolean }>;
  scopes?: Array<{ label: string; description: string; selected: boolean }>;
  tabs?: string[];
  cards?: Array<{ name: string; detail: string; meta?: string; selected?: boolean; kind?: string }>;
};

const screens: ScreenModel[] = [
  { id: "welcome", label: "1. Welcome", title: "Linqa World", variant: "welcome", subtitle: ["Connect Locally. Connect Globally."], primaryAction: "Get Started", secondaryAction: "Log In" },
  { id: "verifyPhone", label: "2. Phone Verification", title: "Verify Your Phone", variant: "verifyPhone", subtitle: ["Enter your mobile number", "get started"], primaryAction: "Send OTP", country: "United States", phone: "(555) 123-4567" },
  { id: "otp", label: "3. OTP Verification", title: "Enter OTP", variant: "otp", subtitle: ["We sent a 6-digit code to", "+1 (555) 123-4567"], primaryAction: "Verify", secondaryAction: "Didn’t receive code?" },
  { id: "countryDetected", label: "4. Country Detected", title: "Detected Country", variant: "countryDetected", subtitle: ["We detected your country", "based on your phone number."], primaryAction: "Continue", country: "United States" },
  { id: "discoveryScope", label: "5. Discovery Scope", title: "Choose Your Discovery Scope", variant: "discoveryScope", subtitle: ["How would you like to connect", "on Linqa World?"], primaryAction: "Continue", scopes: [
    { label: "My Country Only", description: "Connect only with people in my country.", selected: true },
    { label: "My Selected Countries", description: "Choose specific countries you want to connect with.", selected: false },
    { label: "My Region", description: "Connect within a region or multiple regions.", selected: false },
    { label: "Worldwide", description: "Connect with people from all over the world.", selected: false }
  ] },
  { id: "complete", label: "6. Completed", title: "Onboarding Complete", variant: "complete", subtitle: ["You’re all set!", "Welcome to Linqa World.", "Start connecting and building meaningful relationships."], primaryAction: "Explore Linqa" },
  { id: "discoverySettings", label: "2.1 Current Mode", title: "Discovery Settings", variant: "discoverySettings", subtitle: ["Current Mode"], primaryAction: "Save Changes", toggles: [
    { label: "Show my city", active: false },
    { label: "Show my state", active: true },
    { label: "Show my country", active: true }
  ], country: "United States" },
  { id: "selectCountries", label: "2.2 My Selected Countries", title: "Select Countries", variant: "selectCountries", subtitle: ["Choose countries you want", "to connect with (Max 20)"], primaryAction: "Save", countries: [
    { name: "United States", selected: true },
    { name: "Canada", selected: true },
    { name: "United Kingdom", selected: true },
    { name: "Ghana", selected: true },
    { name: "Australia", selected: false },
    { name: "Germany", selected: false },
    { name: "France", selected: false },
    { name: "Japan", selected: false }
  ] },
  { id: "selectRegion", label: "2.3 My Region", title: "Select Region", variant: "selectRegion", subtitle: ["Choose a region to connect", "within that region."], primaryAction: "Save", selectedRegion: "West Africa", regions: [
    "North America", "Europe", "West Africa", "Eastern Africa", "Central Africa", "Southern Africa", "Middle East", "Caribbean", "Asia-Pacific", "South America"
  ] },
  { id: "worldwide", label: "2.4 Worldwide", title: "Worldwide", variant: "worldwide", subtitle: ["You will be able to connect", "with people from all over", "the world."], primaryAction: "Save Preference" },
  { id: "premiumPlans", label: "2.5 Premium Plans", title: "Premium Plans", variant: "premiumPlans", subtitle: ["Unlock More Connections", "Upgrade to connect with more countries and access premium features."], primaryAction: "Upgrade Now", cards: [
    { name: "Free", detail: "My Country Only", meta: "$0", kind: "free" },
    { name: "Premium", detail: "Up to 20 Countries", meta: "$4.99", kind: "premium", selected: true },
    { name: "Elite", detail: "Unlimited Countries", meta: "$9.99", kind: "elite" }
  ] },
  { id: "worldHome", label: "3.1 World Home", title: "World", variant: "worldHome", subtitle: ["My Mode: My Country", "United States"], primaryAction: "Explore", tabs: ["Home", "World", "Chat", "Notifications", "Me"], cards: [
    { name: "Trending Now", detail: "#USA #Music #Travel" }
  ] },
  { id: "people", label: "3.2 People Discovery", title: "People", variant: "people", subtitle: ["Search people"], primaryAction: "Add", cards: [
    { name: "Olivia Johnson", detail: "New York, USA", meta: "Photographer", kind: "person" },
    { name: "Liam Anderson", detail: "Chicago, USA", meta: "Developer", kind: "person" },
    { name: "Emma Davis", detail: "Miami, USA", meta: "Designer", kind: "person" },
    { name: "James Wilson", detail: "Austin, USA", meta: "Product Manager", kind: "person" },
    { name: "Sophia Brown", detail: "Seattle, USA", meta: "Engineer", kind: "person" }
  ] },
  { id: "events", label: "3.3 Events", title: "Events", variant: "events", subtitle: ["For You", "This Week", "This Month"], tabs: ["For You", "This Week", "This Month"], cards: [
    { name: "Music Festival 2025", detail: "Los Angeles, CA", meta: "May 24, 2025", kind: "event" },
    { name: "Tech Conference", detail: "Austin, TX", meta: "May 29, 2025", kind: "event" },
    { name: "Food Carnival", detail: "New York, NY", meta: "Jun 6, 2025", kind: "event" }
  ] },
  { id: "businesses", label: "3.4 Businesses", title: "Businesses", variant: "businesses", subtitle: ["Search businesses"], tabs: ["All", "Restaurant", "Hotel", "Shop"], cards: [
    { name: "Sunset Restaurant", detail: "Los Angeles, CA", meta: "4.5 (200)", kind: "business" },
    { name: "Ocean View Hotel", detail: "Miami, FL", meta: "4.7 (156)", kind: "business" },
    { name: "Tech Solutions Inc.", detail: "Austin, TX", meta: "4.6 (779)", kind: "business" }
  ] },
  { id: "communities", label: "3.5 Communities", title: "Communities", variant: "communities", subtitle: ["Search communities"], primaryAction: "View All", cards: [
    { name: "Travel Lovers USA", detail: "12.5K members", kind: "community" },
    { name: "Tech Enthusiasts", detail: "8.2K members", kind: "community" },
    { name: "Foodies United", detail: "15.3K members", kind: "community" }
  ] }
];

function StatusBar() {
  return (
    <View style={styles.statusBar}>
      <Text style={styles.statusText}>9:41</Text>
      <Text style={styles.signalText}>◔◌◍</Text>
    </View>
  );
}

function PhoneShell({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <View style={styles.phoneShell}>
      <StatusBar />
      <View style={styles.phoneInner}>{children}</View>
      {title ? <Text style={styles.deviceTitle}>{title}</Text> : null}
    </View>
  );
}

function renderToggleList(items: Array<{ label: string; active: boolean }>) {
  return items.map((toggle) => (
    <View key={toggle.label} style={styles.toggleRow}>
      <Text style={styles.toggleText}>{toggle.label}</Text>
      <View style={[styles.toggle, toggle.active && styles.toggleOn]}>
        <View style={[styles.toggleKnob, toggle.active && styles.toggleKnobOn]} />
      </View>
    </View>
  ));
}

function renderScopeList(items: Array<{ label: string; description: string; selected: boolean }>) {
  return items.map((item, index) => (
    <View key={item.label} style={[styles.scopeOption, item.selected && styles.scopeOptionSelected]}>
      <View style={[styles.radio, item.selected && styles.radioSelected]} />
      <View style={styles.scopeLabelWrap}>
        <Text style={styles.scopeOptionLabel}>{item.label}</Text>
        <Text style={styles.scopeOptionDesc}>{item.description}</Text>
      </View>
    </View>
  ));
}

function renderCountryList(items: Array<{ name: string; selected: boolean }>) {
  return items.map((country) => (
    <View key={country.name} style={styles.countryItem}>
      <Text style={styles.countryFlag}>{FLAG_BY_NAME[country.name] ?? "🏳️"}</Text>
      <Text style={styles.countryName}>{country.name}</Text>
      <View style={[styles.checkSquare, country.selected && styles.checkSelected]}>
        {country.selected ? <Text style={styles.checkmark}>✓</Text> : null}
      </View>
    </View>
  ));
}

function renderRegionList(items: string[], selected: string) {
  return items.map((region) => (
    <View key={region} style={[styles.regionItem, region === selected && styles.regionItemSelected]}>
      <View style={[styles.radio, region === selected && styles.radioSelected]} />
      <Text style={styles.regionText}>{region}</Text>
    </View>
  ));
}

function renderMockScreen(screen: ScreenModel) {
  switch (screen.variant) {
    case "welcome":
      return (
        <View style={styles.cardBody}>
          <View style={styles.heroGlow}>
            <Text style={styles.heroBadge}>◉</Text>
            <Text style={styles.heroTitle}>{screen.title}</Text>
            {screen.subtitle?.map((line) => <Text key={line} style={styles.heroSubtitle}>{line}</Text>)}
            <View style={styles.worldMap} />
            <Pressable style={styles.primaryButtonSmall}>
              <Text style={styles.primaryButtonSmallText}>{screen.primaryAction}</Text>
            </Pressable>
            <Text style={styles.inlineLink}>{screen.secondaryAction}</Text>
          </View>
        </View>
      );
    case "verifyPhone":
      return (
        <View style={styles.simpleBody}>
          <Text style={styles.backArrow}>‹</Text>
          <Text style={styles.screenTitle}>{screen.title}</Text>
          {screen.subtitle?.slice(0, 2).map((line, index) => (
            <Text key={line} style={[styles.mutedText, index === 1 && styles.ghostText]}>{line}</Text>
          ))}
          <View style={styles.selectorRow}>
            <Text style={styles.flag}>🇺🇸</Text>
            <Text style={styles.selectorChevron}>⌄</Text>
            <Text style={styles.phoneText}>{screen.phone ?? "(555) 123-4567"}</Text>
          </View>
          <Pressable style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{screen.primaryAction}</Text>
          </Pressable>
          <View style={styles.secureWrap}>
            <Text style={styles.securityMark}>🔒</Text>
            <Text style={styles.secureText}>Secure &amp; private</Text>
          </View>
          <Text style={styles.secureHint}>We&apos;ll never share your number with anyone.</Text>
        </View>
      );
    case "otp":
      return (
        <View style={styles.simpleBody}>
          <Text style={styles.backArrow}>‹</Text>
          <Text style={styles.screenTitle}>{screen.title}</Text>
          <Text style={styles.mutedText}>{screen.subtitle?.[0]}</Text>
          <Text style={styles.ghostText}>{screen.subtitle?.[1]}</Text>
          <View style={styles.otpRow}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <View key={n} style={styles.otpBox}><Text style={styles.otpText}>{n}</Text></View>
            ))}
          </View>
          <Text style={styles.timerText}>Resend code in 00:30</Text>
          <Text style={styles.inlineLink}>{screen.secondaryAction}</Text>
        </View>
      );
    case "countryDetected":
      return (
        <View style={styles.simpleBodyCentered}>
          <Text style={styles.backArrow}>‹</Text>
          <Text style={styles.screenTitle}>{screen.title}</Text>
          <View style={styles.countryTextBlock}>
            {screen.subtitle?.map((line) => <Text key={line} style={styles.mutedText}>{line}</Text>)}
          </View>
          <View style={styles.flagCircle}><Text style={styles.flagLarge}>{FLAG_BY_NAME[screen.country ?? "United States"]}</Text></View>
          <Text style={styles.countryText}>{screen.country ?? "United States"}</Text>
          <Text style={styles.inlineLinkPrimary}>Change Country</Text>
          <Pressable style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{screen.primaryAction}</Text>
          </Pressable>
        </View>
      );
    case "discoveryScope":
      return (
        <View style={styles.simpleBody}>
          <Text style={styles.backArrow}>‹</Text>
          <Text style={styles.screenTitle}>{screen.title}</Text>
          <View style={styles.scopeHeaderBlock}>
            {screen.subtitle?.map((line) => <Text key={line} style={styles.mutedText}>{line}</Text>)}
          </View>
          <View style={styles.scopeList}>{renderScopeList(screen.scopes ?? [])}</View>
          <Pressable style={styles.primaryButton}><Text style={styles.primaryButtonText}>{screen.primaryAction}</Text></Pressable>
        </View>
      );
    case "complete":
      return (
        <View style={styles.completeBody}>
          <Text style={styles.screenTitle}>{screen.title}</Text>
          <View style={styles.worldGlobe}><View style={styles.globeCheck}>✓</View></View>
          {screen.subtitle?.map((line, index) => (
            <Text key={line} style={[styles.completeText, index === 0 && styles.completeGreeting]}>{line}</Text>
          ))}
          <Pressable style={styles.primaryButton}><Text style={styles.primaryButtonText}>{screen.primaryAction}</Text></Pressable>
        </View>
      );
    case "discoverySettings":
      return (
        <View style={styles.simpleBody}>
          <Text style={styles.backArrow}>‹</Text>
          <Text style={styles.screenTitle}>{screen.title}</Text>
          <View style={styles.rowLabelBlock}><Text style={styles.rowLabel}>Current Mode</Text></View>
          <View style={styles.inlineBox}>
            <Text style={styles.inlineBoxTitle}>My Country Only</Text>
            <Text style={styles.inlineBoxMeta}>{screen.country ?? "United States"}</Text>
            <Text style={styles.inlineBoxAction}>Change</Text>
          </View>
          <Text style={styles.sectionHeading}>Privacy</Text>
          {renderToggleList(screen.toggles ?? [])}
          <Pressable style={styles.primaryButton}><Text style={styles.primaryButtonText}>{screen.primaryAction}</Text></Pressable>
        </View>
      );
    case "selectCountries":
      return (
        <View style={styles.simpleBody}>
          <Text style={styles.backArrow}>‹</Text>
          <Text style={styles.screenTitle}>{screen.title}</Text>
          {screen.subtitle?.map((line) => <Text key={line} style={styles.mutedText}>{line}</Text>)}
          <View style={styles.searchBox}><Text style={styles.searchText}>Search countries</Text></View>
          <View style={styles.countryList}>{renderCountryList(screen.countries ?? [])}</View>
          <Text style={styles.countText}>{(screen.countries ?? []).filter((item) => item.selected).length} countries selected</Text>
          <Pressable style={styles.primaryButton}><Text style={styles.primaryButtonText}>{screen.primaryAction}</Text></Pressable>
        </View>
      );
    case "selectRegion":
      return (
        <View style={styles.simpleBody}>
          <Text style={styles.backArrow}>‹</Text>
          <Text style={styles.screenTitle}>{screen.title}</Text>
          {screen.subtitle?.map((line) => <Text key={line} style={styles.mutedText}>{line}</Text>)}
          <View style={styles.regionList}>{renderRegionList(screen.regions ?? [], screen.selectedRegion ?? "West Africa")}</View>
          <Pressable style={styles.primaryButton}><Text style={styles.primaryButtonText}>{screen.primaryAction}</Text></Pressable>
        </View>
      );
    case "worldwide":
      return (
        <View style={styles.simpleBodyCentered}>
          <Text style={styles.backArrow}>‹</Text>
          <Text style={styles.screenTitle}>{screen.title}</Text>
          <View style={styles.worldSphere}><View style={styles.profileCircle} /><View style={styles.profileCircle2} /><View style={styles.profileCircle3} /></View>
          {screen.subtitle?.map((line) => <Text key={line} style={styles.explainText}>{line}</Text>)}
          <Pressable style={styles.primaryButton}><Text style={styles.primaryButtonText}>{screen.primaryAction}</Text></Pressable>
        </View>
      );
    case "premiumPlans":
      return (
        <View style={styles.simpleBody}>
          <Text style={styles.backArrow}>‹</Text>
          <Text style={styles.screenTitle}>{screen.title}</Text>
          {screen.subtitle?.slice(0, 2).map((line) => <Text key={line} style={styles.mutedText}>{line}</Text>)}
          {(screen.cards ?? []).map((card) => (
            <View key={card.name} style={[styles.planCard, card.selected && styles.planCardSelected]}>
              <Text style={styles.planTitle}>{card.name}</Text>
              <View style={styles.planRow}><Text style={styles.planName}>{card.detail}</Text><Text style={styles.planPrice}>{card.meta}</Text></View>
            </View>
          ))}
          <Pressable style={styles.primaryButton}><Text style={styles.primaryButtonText}>{screen.primaryAction}</Text></Pressable>
        </View>
      );
    case "worldHome":
      return (
        <View style={styles.simpleBody}>
          <Text style={styles.backArrow}>‹</Text>
          <Text style={styles.screenTitle}>{screen.title}</Text>
          <Text style={styles.subtleHeader}>{screen.subtitle?.[0]}</Text>
          <View style={styles.topRow}><Text style={styles.locationText}>{screen.subtitle?.[1]}</Text></View>
          <Text style={styles.tagTitle}>Trending Now</Text>
          <View style={styles.pillRow}><Text style={styles.pill}>#USA</Text><Text style={styles.pill}>#Music</Text><Text style={styles.pill}>#Travel</Text></View>
          <View style={styles.heroImage} />
          <View style={styles.bottomTabs}>
            {(screen.tabs ?? ["Home", "World", "Chat", "Notifications", "Me"]).map((tab, index) => (
              <View key={tab} style={[styles.tab, index === 1 && styles.tabSelected]}>
                <Text style={[styles.tabText, index === 1 && styles.tabTextSelected]}>{tab}</Text>
              </View>
            ))}
          </View>
        </View>
      );
    case "people":
      return (
        <View style={styles.simpleBody}>
          <Text style={styles.backArrow}>‹</Text>
          <Text style={styles.screenTitle}>{screen.title}</Text>
          <View style={styles.searchBox}><Text style={styles.searchText}>{screen.subtitle?.[0] ?? "Search people"}</Text></View>
          <View style={styles.peopleList}>
            {(screen.cards ?? []).map((card) => (
              <View key={card.name} style={styles.personRow}>
                <View style={styles.personAvatar} />
                <View style={styles.personMeta}>
                  <Text style={styles.personName}>{card.name}</Text>
                  <Text style={styles.personPlace}>{card.detail}</Text>
                  <Text style={styles.personRole}>{card.meta}</Text>
                </View>
                <Text style={styles.personPlus}>+</Text>
              </View>
            ))}
          </View>
        </View>
      );
    case "events":
      return (
        <View style={styles.simpleBody}>
          <Text style={styles.backArrow}>‹</Text>
          <Text style={styles.screenTitle}>{screen.title}</Text>
          <View style={styles.tabsRow}>
            {(screen.tabs ?? ["For You", "This Week", "This Month"]).map((tab, index) => (
              <Text key={tab} style={[styles.smallTab, index === 0 && styles.smallTabActive]}>{tab}</Text>
            ))}
          </View>
          {(screen.cards ?? []).map((card, index) => (
            <View key={card.name} style={styles.eventRow}>
              <View style={[styles.eventThumb, index === 0 && styles.eventThumbA, index === 1 && styles.eventThumbB, index === 2 && styles.eventThumbC]} />
              <View style={styles.eventMeta}>
                <Text style={styles.eventTitle}>{card.name}</Text>
                <Text style={styles.eventPlace}>{card.detail}</Text>
                <Text style={styles.eventDate}>{card.meta}</Text>
              </View>
              <Text style={styles.eventButton}>Interested</Text>
            </View>
          ))}
        </View>
      );
    case "businesses":
      return (
        <View style={styles.simpleBody}>
          <Text style={styles.backArrow}>‹</Text>
          <Text style={styles.screenTitle}>{screen.title}</Text>
          <View style={styles.searchBox}><Text style={styles.searchText}>{screen.subtitle?.[0] ?? "Search businesses"}</Text></View>
          <View style={styles.iconRow}>
            {(screen.tabs ?? ["All", "Restaurant", "Hotel", "Shop"]).map((tab, index) => (
              <View key={tab} style={[styles.iconChip, index === 0 && styles.iconChipActive]}>
                <Text style={[styles.iconChipText, index === 0 && styles.iconChipTextActive]}>{tab}</Text>
              </View>
            ))}
          </View>
          {(screen.cards ?? []).map((card) => (
            <View key={card.name} style={styles.businessRow}>
              <View style={styles.businessThumb} />
              <View style={styles.businessMeta}>
                <Text style={styles.businessName}>{card.name}</Text>
                <Text style={styles.businessPlace}>{card.detail}</Text>
                <Text style={styles.businessRating}>{card.meta}</Text>
              </View>
            </View>
          ))}
        </View>
      );
    case "communities":
      return (
        <View style={styles.simpleBody}>
          <Text style={styles.backArrow}>‹</Text>
          <Text style={styles.screenTitle}>{screen.title}</Text>
          <View style={styles.searchBox}><Text style={styles.searchText}>{screen.subtitle?.[0] ?? "Search communities"}</Text></View>
          <Text style={styles.subtleHeader}>My Communities</Text>
          {(screen.cards ?? []).map((card) => (
            <View key={card.name} style={styles.communityRow}>
              <View style={styles.communityAvatar} />
              <View style={styles.communityMeta}>
                <Text style={styles.communityName}>{card.name}</Text>
                <Text style={styles.communityCount}>{card.detail}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </View>
          ))}
        </View>
      );
    default:
      return null;
  }
}

export default function CountryLinqaFullFlowScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerBack}><Text style={styles.backText}>‹</Text></Pressable>
          <Text style={styles.title}>CountryLinqa™ (Linqa World) – Complete Flow</Text>
          <View style={styles.brandPill}><Text style={styles.brandText}>Linqa</Text></View>
        </View>
        <View style={styles.grid}>
          {screens.map((screen) => (
            <View key={screen.id} style={styles.gridCard}>
              <PhoneShell title={screen.label}>{renderMockScreen(screen)}</PhoneShell>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#eceef3" },
  scrollContent: { paddingHorizontal: 14, paddingTop: 16, paddingBottom: 60 },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 16, paddingHorizontal: 2 },
  headerBack: { width: 34, height: 34, borderRadius: 17, justifyContent: "center", alignItems: "center" },
  backText: { fontSize: 26, color: text },
  title: { flex: 1, fontSize: 19, fontWeight: "900", color: text, marginLeft: 8, letterSpacing: -0.3 },
  brandPill: { backgroundColor: "#f0ecff", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: "rgba(101,88,220,0.16)" },
  brandText: { color: purple, fontWeight: "800", fontSize: 13, letterSpacing: 0.2 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 14 },
  gridCard: { width: "31.5%", minWidth: 240, marginBottom: 14, alignItems: "center" },
  phoneShell: { borderWidth: 2, borderColor: "#171717", borderRadius: 34, backgroundColor: "#fff", overflow: "hidden", width: "100%", maxWidth: 286, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  statusBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  statusText: { fontSize: 12, fontWeight: "700", color: text },
  signalText: { fontSize: 11, color: text },
  phoneInner: { paddingHorizontal: 14, paddingBottom: 15, minHeight: 420, backgroundColor: shellBg },
  deviceTitle: { fontSize: 10, fontWeight: "800", letterSpacing: 0.7, color: purple, textAlign: "center", marginTop: 8, marginBottom: 10, textTransform: "uppercase" },
  cardBody: { flex: 1, backgroundColor: "#f1f4f9", borderRadius: 22 },
  heroGlow: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#4b4bd8", borderRadius: 24, paddingTop: 18, paddingBottom: 18, paddingHorizontal: 18 },
  heroBadge: { fontSize: 26, marginBottom: 8, color: "#fff" },
  heroTitle: { fontSize: 31, fontWeight: "900", color: "#fff", letterSpacing: -0.7, lineHeight: 35, textAlign: "center" },
  heroSubtitle: { fontSize: 12, color: "#eceafe", textAlign: "center", marginTop: 6, letterSpacing: 0.1 },
  worldMap: { width: 178, height: 140, borderRadius: 90, backgroundColor: "rgba(255,255,255,0.16)", marginTop: 16, marginBottom: 16 },
  primaryButtonSmall: { width: "86%", backgroundColor: "#fff", paddingVertical: 12, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: 6 },
  primaryButtonSmallText: { color: purple, fontSize: 15, fontWeight: "900" },
  primaryButtonText: { color: "#fff", fontSize: 15, fontWeight: "900" },
  inlineLink: { marginTop: 12, fontSize: 14, fontWeight: "800", color: purple, alignSelf: "center" },
  simpleBody: { flex: 1, backgroundColor: shellBg, paddingVertical: 12, paddingHorizontal: 12 },
  simpleBodyCentered: { flex: 1, backgroundColor: shellBg, alignItems: "center", paddingVertical: 12, paddingHorizontal: 12 },
  backArrow: { alignSelf: "flex-start", fontSize: 30, color: text, marginBottom: 2 },
  screenTitle: { fontSize: 23, fontWeight: "900", color: text, marginBottom: 10, letterSpacing: -0.35, lineHeight: 29, textAlign: "left" },
  mutedText: { fontSize: 12, color: softText, lineHeight: 18, textAlign: "center" },
  ghostText: { color: purple, fontSize: 12, fontWeight: "700", marginTop: 4, textAlign: "center" },
  selectorRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: border, borderRadius: 12, backgroundColor: "#fff", height: 42, marginTop: 12, paddingHorizontal: 12 },
  flag: { fontSize: 18 },
  selectorChevron: { color: softText, marginLeft: 6, marginRight: 8 },
  phoneText: { flex: 1, color: text, fontSize: 15, fontWeight: "700" },
  primaryButton: { width: "100%", backgroundColor: purple, borderRadius: 16, paddingVertical: 13, alignItems: "center", justifyContent: "center", marginTop: 16, alignSelf: "stretch", shadowColor: "#6f5ae6", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  secureWrap: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 18 },
  securityMark: { fontSize: 14, marginRight: 8 },
  secureText: { fontSize: 13, fontWeight: "800", color: text },
  secureHint: { marginTop: 6, textAlign: "center", fontSize: 11, color: softText, lineHeight: 16 },
  otpRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 12, marginBottom: 12 },
  otpBox: { width: 36, height: 48, borderRadius: 10, backgroundColor: "#fff", borderWidth: 1, borderColor: border, justifyContent: "center", alignItems: "center" },
  otpText: { fontSize: 17, fontWeight: "800", color: text },
  timerText: { fontSize: 11, color: softText, marginBottom: 8 },
  countryTextBlock: { marginTop: 2, marginBottom: 8, alignItems: "center" },
  flagCircle: { width: 110, height: 110, borderRadius: 55, backgroundColor: "#fff", borderColor: border, borderWidth: 2, alignItems: "center", justifyContent: "center", marginTop: 6 },
  flagLarge: { fontSize: 52 },
  countryText: { fontSize: 20, fontWeight: "900", color: text, marginTop: 12, marginBottom: 4 },
  inlineLinkPrimary: { color: purple, fontWeight: "800", fontSize: 13, marginTop: 4, marginBottom: 14 },
  scopeHeaderBlock: { marginTop: 2, marginBottom: 4 },
  scopeList: { width: "100%", marginTop: 8, gap: 6 },
  scopeOption: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderWidth: 1, borderColor: border, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12 },
  scopeOptionSelected: { backgroundColor: purpleSoft, borderColor: purple, borderWidth: 1.5 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "#c9d3e2", marginRight: 10 },
  radioSelected: { backgroundColor: purple, borderColor: purple },
  scopeLabelWrap: { flex: 1 },
  scopeOptionLabel: { fontSize: 15, fontWeight: "800", color: text },
  scopeOptionDesc: { fontSize: 11, color: softText, marginTop: 2, lineHeight: 15 },
  completeBody: { flex: 1, backgroundColor: shellBg, alignItems: "center", justifyContent: "center", paddingVertical: 12, paddingHorizontal: 12 },
  worldGlobe: { width: 136, height: 136, borderRadius: 68, backgroundColor: "#6bbf6a", borderWidth: 5, borderColor: "#fff", alignItems: "center", justifyContent: "center", marginTop: 6, marginBottom: 12 },
  globeCheck: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#fff", color: "#30c277", fontSize: 26, fontWeight: "900", textAlign: "center", lineHeight: 38 },
  completeGreeting: { fontSize: 17, fontWeight: "900", color: text, marginBottom: 2 },
  completeText: { fontSize: 12, color: softText, textAlign: "center", lineHeight: 18 },
  rowLabelBlock: { width: "100%", marginTop: 8 },
  rowLabel: { color: softText, fontSize: 12, fontWeight: "700" },
  inlineBox: { width: "100%", backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: border, padding: 12, marginTop: 10 },
  inlineBoxTitle: { fontSize: 17, fontWeight: "800", color: text },
  inlineBoxMeta: { fontSize: 12, color: softText, marginTop: 6 },
  inlineBoxAction: { position: "absolute", right: 12, top: 16, color: purple, fontWeight: "800", fontSize: 12 },
  sectionHeading: { width: "100%", marginTop: 22, marginBottom: 8, fontSize: 12, fontWeight: "800", color: softText },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", marginBottom: 10 },
  toggleText: { fontSize: 14, color: text, fontWeight: "600" },
  toggle: { width: 42, height: 22, borderRadius: 18, backgroundColor: "#d9dfe8", padding: 2 },
  toggleOn: { backgroundColor: purple },
  toggleKnob: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#fff", marginTop: 3, marginLeft: 2 },
  toggleKnobOn: { marginLeft: 22 },
  searchBox: { width: "100%", height: 34, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: border, justifyContent: "center", paddingHorizontal: 12, marginTop: 8, marginBottom: 10 },
  searchText: { color: "#9aa4b2", fontSize: 12 },
  countryList: { width: "100%", gap: 4 },
  countryItem: { flexDirection: "row", alignItems: "center", paddingVertical: 5 },
  countryFlag: { fontSize: 17, marginRight: 8 },
  countryName: { flex: 1, color: text, fontSize: 13, fontWeight: "700" },
  checkSquare: { width: 18, height: 18, borderRadius: 5, borderWidth: 2, borderColor: "#d4dbea", justifyContent: "center", alignItems: "center" },
  checkSelected: { backgroundColor: purple, borderColor: purple },
  checkmark: { color: "#fff", fontSize: 12, fontWeight: "900" },
  countText: { marginTop: 8, marginBottom: 6, color: softText, fontSize: 11, fontWeight: "700" },
  regionList: { width: "100%", gap: 5, marginTop: 8 },
  regionItem: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: border, padding: 9 },
  regionItemSelected: { backgroundColor: purpleSoft, borderColor: purple },
  regionText: { color: text, fontSize: 13, fontWeight: "700" },
  explainText: { color: text, fontSize: 12, textAlign: "center", marginBottom: 4 },
  planCard: { width: "100%", backgroundColor: "#fff", borderWidth: 1, borderColor: border, borderRadius: 12, padding: 10, marginTop: 10 },
  planCardSelected: { backgroundColor: purpleSoft, borderColor: purple, borderWidth: 1.5 },
  planTitle: { color: text, fontWeight: "800", fontSize: 13 },
  planRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  planName: { color: text, fontSize: 12, fontWeight: "700" },
  planPrice: { color: purple, fontWeight: "800", fontSize: 12 },
  topRow: { width: "100%", marginBottom: 6 },
  locationText: { fontSize: 12, color: softText },
  subtleHeader: { width: "100%", color: softText, fontWeight: "700", fontSize: 12, marginVertical: 8 },
  tagTitle: { width: "100%", color: text, fontWeight: "700", marginBottom: 6 },
  pillRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  pill: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#fff", borderRadius: 999, borderWidth: 1, borderColor: border, color: purple, fontWeight: "700", fontSize: 11 },
  heroImage: { width: "100%", height: 128, borderRadius: 18, backgroundColor: "#f7c5a3", marginBottom: 8, borderWidth: 1, borderColor: "#f0d0b8" },
  bottomTabs: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: border, paddingTop: 6, marginTop: 6 },
  tab: { alignItems: "center", flex: 1, paddingVertical: 2 },
  tabSelected: { borderBottomWidth: 2, borderBottomColor: purple },
  tabText: { color: softText, fontSize: 10 },
  tabTextSelected: { color: purple, fontWeight: "800" },
  peopleList: { width: "100%", gap: 6 },
  personRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  personAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#d6d9e5" },
  personMeta: { flex: 1, marginLeft: 10 },
  personName: { color: text, fontSize: 14, fontWeight: "800" },
  personPlace: { color: softText, fontSize: 11 },
  personRole: { color: purple, fontSize: 11 },
  personPlus: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: purple, color: purple, textAlign: "center", lineHeight: 22, fontWeight: "800", backgroundColor: "#f5f0ff" },
  tabsRow: { flexDirection: "row", marginBottom: 8, width: "100%", gap: 12 },
  smallTab: { fontSize: 11, color: softText, fontWeight: "700" },
  smallTabActive: { color: purple, borderBottomWidth: 2, borderBottomColor: purple, paddingBottom: 4 },
  eventRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  eventThumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: "#c3d5ff" },
  eventThumbA: { backgroundColor: "#f7ce66" },
  eventThumbB: { backgroundColor: "#8ab7ff" },
  eventThumbC: { backgroundColor: "#f6bd9f" },
  eventMeta: { flex: 1, marginLeft: 10 },
  eventTitle: { color: text, fontSize: 13, fontWeight: "800" },
  eventPlace: { color: softText, fontSize: 11 },
  eventDate: { color: softText, fontSize: 11 },
  eventButton: { color: purple, fontWeight: "800", fontSize: 11, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 999, backgroundColor: "#f2ecff", overflow: "hidden" },
  iconRow: { flexDirection: "row", width: "100%", justifyContent: "space-between", marginBottom: 8 },
  iconChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14, backgroundColor: "#fff", borderWidth: 1, borderColor: border },
  iconChipActive: { backgroundColor: purpleSoft, borderColor: purple },
  iconChipText: { color: text, fontSize: 11, fontWeight: "700" },
  iconChipTextActive: { color: purple },
  businessRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  businessThumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: "#d6e9ff" },
  businessMeta: { flex: 1, marginLeft: 10 },
  businessName: { color: text, fontWeight: "800", fontSize: 13 },
  businessPlace: { color: softText, fontSize: 11 },
  businessRating: { color: purple, fontSize: 11, fontWeight: "700" },
  communityRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#edf0f5" },
  communityAvatar: { width: 42, height: 42, borderRadius: 12, backgroundColor: "#d7d9e5" },
  communityMeta: { flex: 1, marginLeft: 10 },
  communityName: { color: text, fontSize: 14, fontWeight: "800" },
  communityCount: { color: softText, fontSize: 11 },
  chevron: { fontSize: 20, color: softText },
  worldSphere: { width: 180, height: 180, borderRadius: 90, backgroundColor: "#7cc3ff", justifyContent: "center", alignItems: "center", marginVertical: 18 },
  profileCircle: { position: "absolute", width: 38, height: 38, backgroundColor: "#d7d9e5", borderRadius: 19, left: 18, top: 18 },
  profileCircle2: { position: "absolute", width: 38, height: 38, backgroundColor: "#d7d9e5", borderRadius: 19, right: 18, top: 26 },
  profileCircle3: { position: "absolute", width: 38, height: 38, backgroundColor: "#d7d9e5", borderRadius: 19, bottom: 18, left: 65 },
});
