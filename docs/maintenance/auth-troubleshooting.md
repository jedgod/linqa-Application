# Local login and OTP diagnostics

Run the read-only diagnostic from the repository root:

    node scripts/inspect-auth-challenges.mjs "<phone-or-email>"

It loads server/.env and reports challenge status, purpose, remaining attempts,
expiry, account status, and development SMS configuration. It does not print
database credentials, OTP salts, or OTP hashes.

The original inline PowerShell command had nested double quotes around SQL,
an interpolated SQL parameter ($1), and a semicolon where JavaScript required
the logical AND operator. A script file avoids those shell parsing problems.

Brute-forcing a six-digit scrypt hash does not repair an expired challenge.
Login challenges expire after five minutes. Requesting another challenge for
the same identifier and purpose supersedes earlier unconsumed challenges.
Use the newest challenge ID and its matching code. An existing account uses
the LOGIN purpose.

When Twilio is not configured in development, codes are delivered to the
server console rather than by SMS. For a server started by the USB launcher,
the output is in .runtime/mobile-launch/api.log. If another tool starts the
server, consult that process's console/log instead.

The verification screen now offers Send a new code with a resend cooldown,
updates the active challenge ID, and explains expired/replaced codes.

## Session refresh

Access tokens have a shorter lifetime than refresh tokens. The mobile client
now saves the access-token expiry and corrects legacy stored expiry values
using the JWT expiry claim only as a scheduling hint. Server verification is
still authoritative.

Invalid refresh credentials return 401 and require sign-in. Temporary backend
failures return 503, preserving local credentials for retry. Requests used
during startup time out after 15 seconds instead of spinning indefinitely.

Regression checks from the repository root:

    node --import ./server/node_modules/tsx/dist/loader.mjs --test tests/mobile-startup.test.ts tests/auth-session-expiry.test.ts

On Windows, use npm.cmd and npx.cmd if PowerShell rejects the unsigned npm.ps1
or npx.ps1 shims. No execution-policy change is needed.
