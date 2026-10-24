import { HOME_ID, routes as defaultRoutes, type NavRoute } from "./registry";
import { normalizePath } from "./policy";

export type Crumb = {
  label: string;
  /** Absent on the last crumb, and on segments that are not known pages. */
  route?: string;
};

export type NavigationMode = "mobile" | "tablet-compact" | "tablet-expanded" | "desktop";

/** Width breakpoints (dp). Width, not device class, so split-screen reflows. */
export function navigationMode(width: number): NavigationMode {
  if (width < 600) return "mobile";
  if (width < 840) return "tablet-compact";
  if (width < 1200) return "tablet-expanded";
  return "desktop";
}

const segmentsOf = (path: string) =>
  normalizePath(path).split("/").filter((s) => s && !/^\(.*\)$/.test(s) && s !== "index");

// Dynamic [id] screens report the value, not the name; never show it as a label.
const ID_LIKE = /^(?:[0-9a-f]{8}-[0-9a-f-]{27}|[0-9a-f]{12,}|\d{4,})$/i;

function labelFor(segment: string): string {
  const raw = decodeURIComponent(segment);
  if (ID_LIKE.test(raw)) return "Details";
  return raw.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()).trim();
}

/** Registry route owning this path: the one with the longest matching prefix. */
export function resolveRoute(
  pathname: string,
  registry: readonly NavRoute[] = defaultRoutes
): { route: NavRoute; length: number } | undefined {
  const segments = segmentsOf(pathname);
  let best: { route: NavRoute; length: number } | undefined;
  for (const route of registry) {
    for (const base of [route.href, ...(route.match ?? [])]) {
      const prefix = segmentsOf(base);
      const matches = prefix.length > 0 && prefix.length <= segments.length && prefix.every((p, i) => segments[i] === p);
      if (matches && (!best || prefix.length > best.length)) best = { route, length: prefix.length };
    }
  }
  return best;
}

/**
 * Trail for the current path: registered ancestors (linked), then any deeper
 * segments as plain text, since only registry hrefs are known to be pages.
 * A path with no registered owner still gets `Home › <Segment>…`, so every
 * screen has a way back to Home.
 */
export function breadcrumbsForPath(pathname: string, registry: readonly NavRoute[] = defaultRoutes): Crumb[] {
  const byId = new Map(registry.map((r) => [r.id, r]));
  const home = byId.get(HOME_ID);
  const homeLabel = home?.label ?? "Home";
  const segments = segmentsOf(pathname);

  const hit = resolveRoute(pathname, registry);
  if (!hit) {
    if (segments.length === 0) return [{ label: homeLabel }];
    return [{ label: homeLabel, route: home?.href }, ...segments.map((s): Crumb => ({ label: labelFor(s) }))];
  }

  const chain: NavRoute[] = [];
  const seen = new Set<string>();
  for (let node: NavRoute | undefined = hit.route; node && !seen.has(node.id); node = node.parentId ? byId.get(node.parentId) : undefined) {
    seen.add(node.id);
    chain.unshift(node);
  }

  // The landing page of a route (e.g. /countrylinqa/world) is the route itself, not a child of it.
  const landing = segmentsOf(hit.route.href);
  const onLanding = segments.length === landing.length && landing.every((s, i) => s === segments[i]);
  const tail = onLanding ? [] : segments.slice(hit.length);

  const crumbs = chain.map((r, i): Crumb => ({
    label: r.label,
    route: i === chain.length - 1 && tail.length === 0 ? undefined : r.href
  }));
  return [...crumbs, ...tail.map((s): Crumb => ({ label: labelFor(s) }))];
}

/**
 * Keeps the first crumb and the last `max - 1`; `hidden` feeds an overflow
 * control so nothing in the trail becomes unreachable.
 */
export function collapseCrumbs(crumbs: readonly Crumb[], max: number): { visible: Crumb[]; hidden: Crumb[] } {
  if (crumbs.length <= max) return { visible: [...crumbs], hidden: [] };
  const tail = crumbs.slice(-(max - 1));
  return { visible: [crumbs[0], ...tail], hidden: crumbs.slice(1, crumbs.length - tail.length) };
}
