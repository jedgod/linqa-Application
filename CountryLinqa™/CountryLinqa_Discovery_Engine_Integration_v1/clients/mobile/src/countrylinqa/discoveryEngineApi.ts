export type DiscoverySurface =
  | "people"
  | "posts"
  | "events"
  | "businesses"
  | "communities";

export async function loadCountryLinqaSurface(
  api:any,
  surface:DiscoverySurface,
  params:{limit?:number;cursor?:string}={}
) {
  return api.get(`/v2/people-connect/countrylinqa/${surface}`,{params});
}
