# Sealed Sender & Metadata Protection

Linqa defaults to strong sealed-sender semantics so that delivery infrastructure cannot see the true sender of a message in the common case.

Additional goals:
- Minimize recipient visibility and long-term relationship graphs on servers
- Support anonymous / random ID modes
- Reduce linkability across conversations
- Keep residual traffic-analysis surface as small as practical (padding, timing considerations)

This directory will hold the envelope formats, certificate / credential designs, and server-side constraints that enforce these properties.
