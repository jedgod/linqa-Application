export type RouteDef = { id: string; href: string; parentId?: string };
export function validateRoutes(routes: readonly RouteDef[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>(); const hrefs = new Set<string>();
  for (const r of routes) {
    if (ids.has(r.id)) errors.push(`Duplicate route id: ${r.id}`);
    if (hrefs.has(r.href)) errors.push(`Duplicate route href: ${r.href}`);
    ids.add(r.id); hrefs.add(r.href);
  }
  const byId = new Map(routes.map(r => [r.id,r]));
  for (const r of routes) {
    if (r.parentId && !byId.has(r.parentId)) errors.push(`Missing parent for ${r.id}: ${r.parentId}`);
    const seen = new Set<string>(); let cursor: RouteDef | undefined = r;
    while(cursor) {
      if(seen.has(cursor.id)) {errors.push(`Parent cycle involving ${r.id}`);break;}
      seen.add(cursor.id);cursor=cursor.parentId?byId.get(cursor.parentId):undefined;
    }
  }
  return [...new Set(errors)];
}
