const HEX = /^#([0-9a-f]{6})$/i;

/** Average of #RRGGBB colors; anything else (rgba, names) falls back to the first color. */
export function blendColors(colors: readonly string[]): string {
  const first = colors[0] ?? "transparent";
  if (colors.length < 2 || !colors.every((c) => HEX.test(c))) return first;
  const total = colors.reduce(
    (sum, c) => {
      const value = parseInt(HEX.exec(c)![1]!, 16);
      return [sum[0]! + ((value >> 16) & 255), sum[1]! + ((value >> 8) & 255), sum[2]! + (value & 255)];
    },
    [0, 0, 0]
  );
  const channel = (n: number) => Math.round(n / colors.length).toString(16).padStart(2, "0");
  return `#${channel(total[0]!)}${channel(total[1]!)}${channel(total[2]!)}`;
}
