# LinqaChat attachment upgrade

Selected and adapted features from `linqa-attachments+backend` into the live Expo conversation page and Fastify relay.

- The plus button opens a twelve-action grid with a photo-library entry, recipient name, encrypted-send note, and unavailable-action explanations.
- Existing photo capture, editing, voice preview, video capture, polls, events, and meetings remain on their established flows.
- Location pins and contact details now have empty, validated forms and encrypted cards. Pins open in maps; phone numbers open the dialer. Location is entered manually and is not live tracking; contacts are entered manually without reading the address book.
- Cards use `/v2/chats/:id/attachments`. The secure core seals all card fields. The relay sees only the ID, kind, and ciphertext. CONTACT is enabled by migration `062_chat_contact_attachments.sql`.
- Attachment retries on the current service instance reuse their original ciphertext. Backend duplicate IDs must match sender, conversation, kind, vault reference, and bytes. These cards do not gain a durable attachment outbox from this change.
- AI generation, document picking, live screen capture, the prototype's poll extensions, RSVPs, and meeting responses were not imported. They need further integration. The supplied Nest/Prisma module, sample data, empty media buffers, and stand-in encryption were not copied into the live app.

Deploy the backend and run its normal database migration command before distributing the new client. This change does not apply migrations or deploy services automatically.
