# API Wiring

1. Discovery Settings: GET/PUT `/v1/countrylinqa/preferences`
2. Countries: GET `/v1/countrylinqa/catalog`, PUT preferences
3. Region: GET catalog, PUT preferences
4. Worldwide: PUT preferences; server must enforce Elite
5. Plans: connect to Linqa billing/entitlements
6. Success: refresh entitlement + preferences from server

Rules: client plan state is presentation only; server enforces limits. Discovery settings alter reach/visibility, not the verified identity country.
