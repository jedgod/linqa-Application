export type ChatReachMode="MY_COUNTRY"|"SELECTED_COUNTRIES"|"REGION"|"WORLDWIDE"|"EXISTING_CONTACTS_ONLY"|"NOBODY";
export type CountryLinqaChatPolicy={mode:ChatReachMode;countryCodes:string[];regionCode:string|null;existingContactsBypass:boolean;version:number};
export function chatStartError(code?:string){
 if(code==="COUNTRY_NOT_ALLOWED")return"This person is not accepting new chats from your country.";
 if(code==="CONTACTS_ONLY")return"This person accepts new chats from existing contacts only.";
 if(code==="CHAT_REQUESTS_DISABLED")return"This person is not accepting new chat requests.";
 if(code==="COUNTRY_UNVERIFIED")return"Country verification is required before starting this chat.";
 return"You can't start this conversation.";
}
