# Implementation
1. Rename migration to next free live number; adapt to migration 027's real table/columns.
2. Extend existing CountryLinqa service/settings with chat reach; do not create a second policy store.
3. Wire `Deps` to EXISTING block, restricted-user, conversation, contact, verified-country and region helpers.
4. Patch existing POST /v1/chats/direct.
5. Patch existing message-request creation with the SAME authorization function.
6. Add settings UI under existing `clients/mobile/app/settings/countrylinqa.tsx`:
   - My Country
   - Selected Countries
   - My Region
   - Worldwide
   - Existing Contacts Only
   - Nobody
7. Existing chats continue unless normal block/restriction rules stop them.
8. Add DB integration cases proving direct-route and message-request bypass attempts get the same denial.
9. Run migration twice, server build/tests, mobile typecheck and CountryLinqa certification.
10. Extend physical evidence with: denied country, selected-country allow, block-over-worldwide, existing-conversation preservation, and account-switch policy isolation.
