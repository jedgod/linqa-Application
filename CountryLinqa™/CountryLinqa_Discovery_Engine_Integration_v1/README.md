# CountryLinqa™ Discovery Engine Integration v1

This is the integration layer after the Discovery Settings Production Finish pack.

It connects the user's server-authoritative CountryLinqa policy to:
- People
- Country feeds/posts
- Events
- Businesses
- Communities
- Unified search
- Recommendation candidate generation

Core rule:
A client never decides whether a candidate is geographically eligible.
The server resolves the viewer's effective discovery policy and applies it before
ranking, pagination, profile visibility, or recommendation delivery.

Important:
- Verified identity country remains separate from discovery preferences.
- Block/mute/safety rules override CountryLinqa discovery.
- Inbound policy and outbound policy must BOTH permit a new-person exposure.
- Existing contacts may be handled separately from new discovery.
- Precise location is not required by this engine.
