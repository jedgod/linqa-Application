LINQA ADMIN + STAFF OPERATIONS CONSOLE

FILES
1. LinqaAdminStaffConsole.tsx
   Full responsive React/Tailwind console page for Admin, Supervisors and Staff.

2. linqa-admin-staff-types.ts
   RBAC roles and permission matrix.

3. linqa-admin-staff-api.ts
   Express-style protected API route contract and permission middleware.

4. linqa-admin-staff-schema.sql
   PostgreSQL schema for staff accounts, support cases, audit events,
   break-glass access and QA reviews.

RECOMMENDED LINQA PLACEMENT
apps/admin/src/pages/operations/LinqaAdminStaffConsole.tsx
server/src/modules/operations/*
server/src/modules/support/*
server/src/modules/staff-rbac/*
db/migrations/20260814_admin_staff_operations.sql

IMPORTANT SECURITY MODEL
- Admin monitors staff availability, queue loads, SLA, case actions and quality.
- Staff supports clients through assigned cases.
- Supervisors can assign/reassign/escalate and review QA.
- E2EE client messages are not automatically visible to Admin/Staff.
- Vault plaintext and secret security material are never exposed in the console.
- Sensitive support actions require least privilege, fresh MFA/re-authentication,
  purpose codes and immutable audit logs.
- Exceptional access uses short-lived break-glass approval.
- Avoid invasive employee surveillance such as hidden screen capture or keystroke logging.
