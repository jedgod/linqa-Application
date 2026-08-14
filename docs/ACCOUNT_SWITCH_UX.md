# Account Switch UX

Header avatar tap:

Switch account

✓ Personal
  +1 •••• 1234

  Business
  +233 •••• 5678

  Research
  +44 •••• 9012

+ Add account

When three accounts exist:

+ Add account
Maximum of 3 Linqa accounts reached

## Switching rules

- no global logout;
- each account keeps its own refresh session;
- foreground push/UI context follows active account;
- background notifications may still arrive per account;
- notification tap activates the correct account before opening route;
- biometric lock can be required per account;
- account labels are user-editable;
- phone number is always masked in UI.
