INSERT INTO home_news_publishers
  (canonical_domain, display_name, country_code, trust_status, min_provider_score,
   allow_breaking, allow_external_links, attribution_required, notes)
VALUES
  ('foxnews.com',  'FOX News',  'US', 'TRUSTED', 0.60, TRUE,  TRUE, TRUE, '24-hour newsroom'),
  ('edition.cnn.com', 'CNN',    'US', 'TRUSTED', 0.60, TRUE,  TRUE, TRUE, 'CNN international edition'),
  ('gartner.com',  'Gartner',   'US', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Technology research and analysis'),
  ('techcrunch.com', 'TechCrunch', 'US', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Technology publication'),
  ('theverge.com', 'The Verge', 'US', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Technology publication')
ON CONFLICT (canonical_domain) DO NOTHING;
