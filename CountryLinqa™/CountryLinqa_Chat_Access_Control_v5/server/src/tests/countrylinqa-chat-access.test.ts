import{describe,it,expect}from"vitest";
import{authorizeNewDirectChat}from"../services/countrylinqa/chat-access";
const d=(o:any={})=>({getVerifiedCountry:async(id:string)=>id==="s"?"GH":"US",getChatPolicy:async()=>({mode:"MY_COUNTRY",countryCodes:[],regionCode:null,existingContactsBypass:true}),isBlockedEitherDirection:async()=>false,isRestricted:async()=>false,hasExistingDirectConversation:async()=>false,isExistingContact:async()=>false,countryInRegion:(c:string,r:string)=>r==="WEST_AFRICA"&&["GH","NG"].includes(c),...o});
describe("CountryLinqa chat initiation",()=>{
 it("denies foreign country under MY_COUNTRY",async()=>expect((await authorizeNewDirectChat("s","r",d())).allowed).toBe(false));
 it("allows selected country",async()=>expect((await authorizeNewDirectChat("s","r",d({getChatPolicy:async()=>({mode:"SELECTED_COUNTRIES",countryCodes:["GH"],regionCode:null,existingContactsBypass:true})}))).allowed).toBe(true));
 it("block overrides worldwide",async()=>expect((await authorizeNewDirectChat("s","r",d({isBlockedEitherDirection:async()=>true,getChatPolicy:async()=>({mode:"WORLDWIDE",countryCodes:[],regionCode:null,existingContactsBypass:true})}))).allowed).toBe(false));
 it("preserves existing conversation",async()=>expect((await authorizeNewDirectChat("s","r",d({hasExistingDirectConversation:async()=>true}))).allowed).toBe(true));
 it("contacts-only denies stranger",async()=>expect((await authorizeNewDirectChat("s","r",d({getChatPolicy:async()=>({mode:"EXISTING_CONTACTS_ONLY",countryCodes:[],regionCode:null,existingContactsBypass:true})}))).allowed).toBe(false));
 it("region permits member",async()=>expect((await authorizeNewDirectChat("s","r",d({getChatPolicy:async()=>({mode:"REGION",countryCodes:[],regionCode:"WEST_AFRICA",existingContactsBypass:false})}))).allowed).toBe(true));
});
