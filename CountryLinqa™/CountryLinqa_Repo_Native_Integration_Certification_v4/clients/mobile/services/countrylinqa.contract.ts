export type CountryLinqaPerson={
  id:string;
  displayName:string;
  countryCode:string|null;
  avatarUrl:string|null;
  verified:boolean;
};

export type CountryLinqaPost={
  id:string;
  body:string;
  authorUserId:string;
  countryCode:string|null;
  createdAt:string;
};

export function assertPerson(x:any):CountryLinqaPerson{
  if(!x || typeof x.id!=="string" || typeof x.displayName!=="string")
    throw new Error("INVALID_COUNTRYLINQA_PERSON_CONTRACT");
  return x;
}

export function assertPost(x:any):CountryLinqaPost{
  if(!x || typeof x.id!=="string" || typeof x.body!=="string")
    throw new Error("INVALID_COUNTRYLINQA_POST_CONTRACT");
  return x;
}
