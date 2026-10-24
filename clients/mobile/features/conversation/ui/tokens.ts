// Same palette as the canvas mockups (contrast-checked values).
export const palette = {
  bg: "#EEF1F4",
  surface: "#FFFFFF",
  ink: "#1C2833",
  muted: "#5B6B7A",
  line: "#CFD7DF",
  outgoing: "#1F4E5A",
  outgoingInk: "#F4F8F9",
  secure: "#2F6F5E",
  secureTint: "#E6F0EC",
  // Text on secure / danger fills (buttons, tags). White on the light theme's dark greens and reds; dark on the dark theme's light ones.
  onSecure: "#FFFFFF",
  onDanger: "#FFFFFF",
  sealed: "#5F6F7D",
  warn: "#96560F",
  warnSurface: "#FBF1E3",
  danger: "#A12C2C",
  night: "#10161C",
  nightSurface: "#1D2730",
  nightInk: "#E6ECF1",
  nightMuted: "#93A3B1",
  nightLine: "#2C3A46",
  secureOnNight: "#5FB39A",
  warnOnNight: "#E0A458",
};

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24 } as const;

/** Whiteboard ink colors: distinct in lightness as well as hue. */
export const inkColors = ["#1C2833", "#2F6F5E", "#1F5FA8", "#C2410C", "#A12C2C", "#7A4FB0", "#E0A400", "#FFFFFF"];
export const stickyColors = ["#FFE48A", "#BDE5D4", "#C9DCF5", "#F6C9B5", "#E2D3F2"];
