INSERT INTO home_news_publishers
  (canonical_domain, display_name, country_code, trust_status, min_provider_score,
   allow_breaking, allow_external_links, attribution_required, notes)
VALUES
  ('pbs.org', 'PBS News', 'US', 'TRUSTED', 0.60, TRUE, TRUE, TRUE, 'Public broadcaster; first-party headline RSS'),
  ('lemonde.fr', 'Le Monde', 'FR', 'TRUSTED', 0.60, TRUE, TRUE, TRUE, 'First-party English international RSS'),
  ('dw.com', 'DW', 'DE', 'TRUSTED', 0.60, TRUE, TRUE, TRUE, 'Public international broadcaster; English RDF RSS')
ON CONFLICT (canonical_domain) DO NOTHING;
