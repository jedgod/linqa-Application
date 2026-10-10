export type ChatReachMode="MY_COUNTRY"|"SELECTED_COUNTRIES"|"REGION"|"WORLDWIDE"|"EXISTING_CONTACTS_ONLY"|"NOBODY";
export type Decision={allowed:true;reason:string}|{allowed:false;code:string;reason:string};
export interface Deps{
 getVerifiedCountry(id:string):Promise<string|null>;
 getChatPolicy(id:string):Promise<{mode:ChatReachMode;countryCodes:string[];regionCode:string|null;existingContactsBypass:boolean}>;
 isBlockedEitherDirection(a:string,b:string):Promise<boolean>;
 isRestricted(id:string):Promise<boolean>;
 hasExistingDirectConversation(a:string,b:string):Promise<boolean>;
 isExistingContact(a:string,b:string):Promise<boolean>;
 countryInRegion(country:string,region:string):boolean;
}
const n=(x:string)=>x.trim().toUpperCase();
export async function authorizeNewDirectChat(sender:string,recipient:string,d:Deps):Promise<Decision>{
 if(sender===recipient)return{allowed:false,code:"INVALID_RECIPIENT",reason:"Cannot chat with self."};
 if(await d.isBlockedEitherDirection(sender,recipient))return{allowed:false,code:"BLOCKED",reason:"Direct chat unavailable."};
 if(await d.isRestricted(sender)||await d.isRestricted(recipient))return{allowed:false,code:"RESTRICTED_USER",reason:"Direct chat unavailable."};

 // Country reach changes never destroy an already-established conversation.
 if(await d.hasExistingDirectConversation(sender,recipient))return{allowed:true,reason:"EXISTING_CONVERSATION"};

 const p=await d.getChatPolicy(recipient);
 if(p.existingContactsBypass && await d.isExistingContact(sender,recipient))return{allowed:true,reason:"EXISTING_CONTACT"};
 if(p.mode==="NOBODY")return{allowed:false,code:"CHAT_REQUESTS_DISABLED",reason:"Recipient is not accepting new chats."};
 if(p.mode==="EXISTING_CONTACTS_ONLY")return{allowed:false,code:"CONTACTS_ONLY",reason:"Recipient accepts existing contacts only."};

 const sc=await d.getVerifiedCountry(sender), rc=await d.getVerifiedCountry(recipient);
 if(!sc||!rc)return{allowed:false,code:"COUNTRY_UNVERIFIED",reason:"Verified country required."};
 if(p.mode==="WORLDWIDE")return{allowed:true,reason:"COUNTRY_ALLOWED"};
 if(p.mode==="MY_COUNTRY")return n(sc)===n(rc)?{allowed:true,reason:"COUNTRY_ALLOWED"}:{allowed:false,code:"COUNTRY_NOT_ALLOWED",reason:"Recipient accepts new chats from their country only."};
 if(p.mode==="SELECTED_COUNTRIES")return p.countryCodes.map(n).includes(n(sc))?{allowed:true,reason:"COUNTRY_ALLOWED"}:{allowed:false,code:"COUNTRY_NOT_ALLOWED",reason:"Your country is outside recipient chat reach."};
 if(p.mode==="REGION"&&p.regionCode)return d.countryInRegion(n(sc),p.regionCode)?{allowed:true,reason:"COUNTRY_ALLOWED"}:{allowed:false,code:"COUNTRY_NOT_ALLOWED",reason:"Your country is outside recipient chat region."};
 return{allowed:false,code:"CHAT_REQUESTS_DISABLED",reason:"New chat unavailable."};
}
