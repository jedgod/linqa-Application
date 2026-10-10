export type DiscoveryMode='MY_COUNTRY'|'SELECTED_COUNTRIES'|'REGION'|'GLOBAL';
export type InboundReach='MY_COUNTRY'|'SELECTED_COUNTRIES'|'REGION'|'GLOBAL'|'CONTACTS_ONLY';
export type Plan='FREE'|'PREMIUM'|'ELITE';
export type Preferences={outboundMode:DiscoveryMode;inboundReach:InboundReach;selectedCountries:string[];selectedRegion:string|null;showCity:boolean;showState:boolean;showCountry:boolean;verifiedOnly:boolean;allowBusinesses:boolean;allowCommunities:boolean;allowEvents:boolean;paused:boolean};
