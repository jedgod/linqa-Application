// Spacing, corner radii and type for the conversation page. Colours come from the chosen theme
// (services/conversation-engine.ts THEMES): outgoing bubbles use the accent, sealed ones are outlined, never filled,
// so a locked thread reads as unopened envelopes rather than as broken content.
export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24 } as const;
export const radius = { bubble: 18, tail: 6, control: 22 } as const;
export const type = {
  body: { fontSize: 16, lineHeight: 22 },
  meta: { fontSize: 12, lineHeight: 16 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: "600" as const }
};
