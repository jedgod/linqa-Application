# CountryLinqa Chat Access Control v5
CountryLinqa controls who may START a new chat by country. All conversations remain in the main Linqa Chats inbox.

Preserve:
- GET /v1/chats/inbox
- POST /v1/chats/direct { userId }
- existing block/restricted-user/abuse checks
- existing direct conversations
- no stranger Online Now exposure
- no second moderation or chat system

Enforce server-side at BOTH direct-conversation creation and message-request creation so the rule cannot be bypassed by a client.
