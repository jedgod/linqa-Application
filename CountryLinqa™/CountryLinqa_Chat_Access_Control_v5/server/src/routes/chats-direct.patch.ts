// PATCH the EXISTING POST /v1/chats/direct handler. Do not register another route.
import {authorizeNewDirectChat} from "../services/countrylinqa/chat-access";

/*
const sender=req.auth.userId;
const recipient=req.body.userId;
await existingAbuseChecks(...);

const decision=await authorizeNewDirectChat(sender,recipient,repoNativeChatAccessDeps);
if(!decision.allowed)
 return res.status(403).json({error:{code:decision.code,message:decision.reason}});

const conversation=await directConversationRepo.findOrCreateAtomic(sender,recipient);
return res.json({conversationId:conversation.id});
*/

// IMPORTANT: call the same authorizeNewDirectChat() at the EXISTING
// message-request creation boundary. Otherwise a caller could bypass /v1/chats/direct.
