# LINQA Dynamic Mobile Information Architecture — Implementation and Gap Register

Date: 2026-08-13

Source of truth: `LINQA_Dynamic_Mobile_Information_Architecture.txt`

## Implemented in this pass

- The primary navigation is now exactly **Home | Calls | + | Chats | Linqa**.
- The center `+` opens a contextual action sheet. Its actions change for Calls, Chats, Vault, LinqaSend, Calendar, and CountryLinqa/Communities routes.
- A searchable Linqa service hub now groups existing services under Connect, Organize, Discover, Money & Business, and Safety & Settings.
- Universal navigation search now routes to real screens instead of displaying hard-coded people and conversations.
- Home now uses the current hub profile and most-recent conversation, and its search, AI, notification, profile, and More controls route to their actual screens.
- Existing hidden routes for Communities, Settings, and Media are preserved, so current integrations and deep links are not broken by the new tab structure.
- Existing capability gates and server-backed Calls, CountryLinqa, LinqaSend, account, security, and mobile-hub clients were retained.

## Pages/routes that now exist

- Home, Calls, Chats, center Create registration route, and Linqa hub
- Search
- Communities and Media (preserved as non-tab routes)
- Account add/manage/remove/sign-up/verification flows
- Authentication registration, phone/recovery verification, and account-created flows
- CountryLinqa list, world, and full-flow pages
- LinqaSend home, amount, recipient, payment-method, review, status, and history pages
- File Vault
- Message requests and status detail
- Privacy Center
- Key transparency
- Notification, privacy-rights, storage, accessibility, AI privacy, and CountryLinqa settings
- Support and Welcome
- Generic capability-gated module route for catalog features

## Pages still not created as dedicated production screens

The generic module route can describe these capabilities, but that is not equivalent to a complete, purpose-built screen and workflow.

| Missing dedicated page/workflow | Current state |
| --- | --- |
| Universal object search results for people, messages, files, media, events, payments, and posts | Navigation/service search exists; no federated object-results screen or API |
| Home customization editor | Linqa hub is reachable from Customize; drag/reorder/pin/hide controls are not built |
| Notification inbox | Preference settings exist; no unified read/unread notification center |
| Deep-link dispatcher and invalid-link recovery screen | Individual routes exist; no centralized link parser/route registry |
| Scheduled-call creation and call-link sharing | Calls and calendar surfaces exist; dedicated creation flows are incomplete |
| Chat saved messages, broadcasts, and secure-file composer | Catalog/capability entries exist; dedicated end-to-end pages are incomplete |
| Vault folder browser, social-media intake, sharing/ACL editor, and storage-plan page | File Vault exists; these flows are not dedicated screens |
| Calendar reminder editor and community-event editor | Generic Calendar/CountryLinqa entry points exist |
| LinqaSend request-money flow | Transfer flow exists; request-money is not a dedicated workflow |
| CountryLinqa create-post, create-event, and go-live composers | CountryLinqa full-flow exists; separate production composers are not present |
| Business workspace, team administration, and business vault | Enterprise catalog surface exists; dedicated mobile pages are absent |
| Personalized recommendations and “because you used…” management | CountryLinqa affinity exists; general Linqa personalization UI is absent |

## Database structures already present

The repository already contains migrations for the core architecture, including:

- users, profiles, identifiers, sessions, passkeys, recovery, devices, multi-account bindings, and account switching
- conversations, members, message state/envelopes, message requests, groups, attachments, and encrypted voice notes
- call sessions, participants, history, scheduled calls, signaling, recordings, and retention controls
- communities, memberships, channels, events, posts, statuses, reactions, replies, and moderation/safety records
- vault items, backups, secure notes, calendar events/attendees, media index, storage snapshots, and wallet items
- push endpoints/tokens, delivery attempts/events, notification preferences, and security notifications
- CountryLinqa geography, discovery preferences, memberships, businesses, events/posts, saved searches, affinity/recommendation events, moderation, rollout, and audit tables
- LinqaSend payment methods, recipients, corridors, rates, quotes, transfers, attempts, ledger, risk, compliance, and webhook tables
- enterprise organizations, memberships, identity providers, policies, SCIM directory, audit, retention, legal hold, compliance, and support structures

## Database structures not created or not generalized for this architecture

These are the confirmed architecture-level persistence gaps. Some can initially be implemented as columns or JSON preferences, but no current migration provides the full general-purpose model.

1. **Home/service personalization** — no general tables for pinned services, module order, hidden modules, quick-action order, or per-account Home layout.
2. **Universal search** — no cross-module search index/query model covering messages, people, files, calls, calendar, notes, communities, CountryLinqa, and LinqaSend. CountryLinqa saved searches are domain-specific only.
3. **Unified notification inbox** — delivery and preference tables exist, but no general notification-item/read-state table with a typed destination object for in-app routing.
4. **Deep-link registry/state** — no persisted short-link/call-link registry, link revocation, expiration, or resolution-audit model.
5. **General recommendation telemetry** — CountryLinqa recommendation events exist, but no cross-product activity/affinity model for personalized Home modules.
6. **Vault hierarchy and sharing** — `vault_items` exists, but no complete folder tree, item ACL/share grants, social-intake job, or intake-source connection model.
7. **Money requests** — LinqaSend transfers are modeled, but request-money/invoice requests and their lifecycle are not represented as a dedicated entity.
8. **Reminders** — calendar events exist, but no independent reminder entity with recurrence, snooze, completion, and notification linkage.
9. **Business mobile workspace state** — enterprise tables exist, but no business-specific mobile workspace layout, team vault membership, or business service-pinning model.

## Integration limitations that remain

- Home's `MobileHubService` uses a development-only endpoint with a fixed demo persona header and is disabled in production. A production, authenticated Home aggregation endpoint is still required.
- The supplied Home reference includes editorial news, trending, and spotlight data. The current visual cards are presentation content; there is no general editorial feed API backing all of them.
- The new universal search deliberately searches real navigable services only. It does not fabricate user or message results while the federated backend is missing.
- Capability gates remain in place. A route appearing in the hub does not bypass authentication, environment, or workflow-completeness checks.

## Recommended implementation order

1. Build the authenticated Home aggregation and unified notification inbox APIs.
2. Add personalization persistence and a Home customization editor.
3. Add federated search indexing/API with authorization filtering per result type.
4. Complete create workflows for calls, chat attachments, Vault intake/folders, reminders, CountryLinqa publishing, and request-money.
5. Add deep-link resolution with expiry/revocation and notification destination routing.
6. Add mobile integration tests for tab routing, contextual create actions, account switching, deep links, and capability-gate enforcement.
