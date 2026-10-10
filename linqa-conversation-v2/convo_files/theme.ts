import { useColorScheme } from "react-native";

// Cool, quiet palette. Verdigris marks "secure and open", amber marks "sealed
// for a reason you can act on". Sealed bubbles are outlined, never filled, so
// a locked thread reads as unopened envelopes rather than as broken content.

const light = {
  bg: "#EEF1F4",
  surface: "#FFFFFF",
  ink: "#1C2833",
  inkMuted: "#5B6B7A",
  line: "#CFD7DF",
  outgoing: "#1F4E5A",
  outgoingInk: "#F4F8F9",
  secure: "#2F6F5E",
  sealed: "#7A8B99",
  warn: "#A8641A",
  warnSurface: "#FBF1E3",
};

const dark: typeof light = {
  bg: "#141B22",
  surface: "#1D2730",
  ink: "#E6ECF1",
  inkMuted: "#93A3B1",
  line: "#2C3A46",
  outgoing: "#2B6573",
  outgoingInk: "#F4F8F9",
  secure: "#5FB39A",
  sealed: "#7F91A0",
  warn: "#E0A458",
  warnSurface: "#2C2418",
};

export type ConversationTheme = typeof light;

/** Pass the thread's saved theme as override if the user picked one in settings. */
export function useConversationTheme(override?: "light" | "dark"): ConversationTheme {
  const system = useColorScheme();
  return (override ?? system) === "dark" ? dark : light;
}

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24 } as const;
export const radius = { bubble: 18, tail: 6, control: 22 } as const;
export const type = {
  body: { fontSize: 16, lineHeight: 22 },
  meta: { fontSize: 12, lineHeight: 16 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: "600" as const },
};
