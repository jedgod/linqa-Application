import type { ImageSourcePropType } from "react-native";

/**
 * Hero photos for Country Hub pages, by ISO country code. A country with an entry here gets its
 * photo (a skyline or landmark of that country); every other country gets the flag-based hero.
 *
 * To add one, put the image in assets/countries/ and register it with a static require, for example
 *   GH: require("../../assets/countries/gh.jpg"),
 * The path must be written out in full: the bundler cannot follow a computed path. Use photos the
 * product has the right to show; none are bundled yet.
 */
const HEROES: Record<string, ImageSourcePropType> = {};

export function heroFor(code: string): ImageSourcePropType | null {
  return HEROES[code.toUpperCase()] ?? null;
}
