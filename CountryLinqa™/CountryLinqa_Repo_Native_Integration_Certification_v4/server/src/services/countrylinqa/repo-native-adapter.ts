/**
 * Compatibility boundary for CountryLinqa UI/API naming.
 * Keep wire format stable and map DB snake_case -> client camelCase here.
 * Do not make screens guess backend field names.
 */
export type CountryLinqaPersonRow={
  id:string;
  display_name:string|null;
  verified_country_code:string|null;
  avatar_url?:string|null;
  identity_verified?:boolean|null;
};

export type CountryLinqaFeedRow={
  id:string;
  body:string|null;
  author_user_id:string;
  country_code?:string|null;
  created_at:string|Date;
};

export function toPersonDto(row:CountryLinqaPersonRow){
  return {
    id:row.id,
    displayName:row.display_name ?? "Linqa User",
    countryCode:row.verified_country_code,
    avatarUrl:row.avatar_url ?? null,
    verified:Boolean(row.identity_verified)
  };
}

export function toFeedDto(row:CountryLinqaFeedRow){
  return {
    id:row.id,
    body:row.body ?? "",
    // transitional compatibility only; remove after all clients consume body
    title:row.body ?? "",
    authorUserId:row.author_user_id,
    countryCode:row.country_code ?? null,
    createdAt:new Date(row.created_at).toISOString()
  };
}
