-- Home publisher trust allowlist.
--
-- WHY THIS MIGRATION IS REQUIRED, NOT OPTIONAL
--
-- The validation chain is fail-closed by arithmetic, not just by policy:
--
--   validationScore = 0.35
--                   + providerScore * 0.25
--                   + trustBonus (TRUSTED 0.30 | LIMITED 0.15 | else 0.05)
--                   + 0.05 if summary + 0.05 if image
--
-- and the router drops anything below 0.65. GDELT reports providerScore 0.70,
-- so an UNKNOWN publisher tops out at 0.35 + 0.175 + 0.05 + 0.10 = 0.675 only
-- when it has both a summary and an image, and PublisherTrustService rejects
-- unlisted domains below providerScore 0.80 before that anyway.
--
-- Net effect with an empty allowlist: every article is rejected and Home
-- reports news: UNAVAILABLE forever, with no error anywhere. So the allowlist
-- is what makes the feed function at all, and /health/home fails readiness
-- when it is empty rather than letting that look healthy.
--
-- SEEDING POLICY
--
-- Seeded entries are widely-cited international and national news
-- organisations with a public masthead, named editorial leadership and a
-- published corrections policy. min_provider_score is 0.60 -- below GDELT's
-- 0.70 so these publishers pass, above the 0.50 default so a provider that
-- reports low confidence in its own match still gets filtered.
--
-- allow_breaking is granted only to wire services and 24-hour newsrooms: the
-- BREAKING treatment is a claim about immediacy, and a weekly or analysis-led
-- publication should not carry it.
--
-- attribution_required is TRUE everywhere. Home always names the publisher.
--
-- This is a starting allowlist for the operations team to curate through
-- /v1/admin/home/publishers (audited, scope-gated), not a fixed list. Adding a
-- publisher here is an editorial decision and should be made deliberately.

INSERT INTO home_news_publishers
  (canonical_domain, display_name, country_code, trust_status, min_provider_score,
   allow_breaking, allow_external_links, attribution_required, notes)
VALUES
  -- Wire services and continuous newsrooms (breaking-cleared)
  ('reuters.com',        'Reuters',                     'GB', 'TRUSTED', 0.60, TRUE,  TRUE, TRUE, 'Wire service'),
  ('apnews.com',         'Associated Press',            'US', 'TRUSTED', 0.60, TRUE,  TRUE, TRUE, 'Wire service'),
  ('afp.com',            'Agence France-Presse',        'FR', 'TRUSTED', 0.60, TRUE,  TRUE, TRUE, 'Wire service'),
  ('bbc.com',            'BBC News',                    'GB', 'TRUSTED', 0.60, TRUE,  TRUE, TRUE, 'Public broadcaster'),
  ('bbc.co.uk',          'BBC News',                    'GB', 'TRUSTED', 0.60, TRUE,  TRUE, TRUE, 'Public broadcaster'),
  ('aljazeera.com',      'Al Jazeera',                  'QA', 'TRUSTED', 0.60, TRUE,  TRUE, TRUE, '24-hour newsroom'),
  ('cnn.com',            'CNN',                         'US', 'TRUSTED', 0.60, TRUE,  TRUE, TRUE, '24-hour newsroom'),
  ('nbcnews.com',        'NBC News',                    'US', 'TRUSTED', 0.60, TRUE,  TRUE, TRUE, '24-hour newsroom'),
  ('cbsnews.com',        'CBS News',                    'US', 'TRUSTED', 0.60, TRUE,  TRUE, TRUE, '24-hour newsroom'),
  ('abcnews.go.com',     'ABC News',                    'US', 'TRUSTED', 0.60, TRUE,  TRUE, TRUE, '24-hour newsroom'),
  ('news.sky.com',       'Sky News',                    'GB', 'TRUSTED', 0.60, TRUE,  TRUE, TRUE, '24-hour newsroom'),
  ('dw.com',             'Deutsche Welle',              'DE', 'TRUSTED', 0.60, TRUE,  TRUE, TRUE, 'Public broadcaster'),
  ('france24.com',       'France 24',                   'FR', 'TRUSTED', 0.60, TRUE,  TRUE, TRUE, 'Public broadcaster'),
  ('abc.net.au',         'ABC News (Australia)',        'AU', 'TRUSTED', 0.60, TRUE,  TRUE, TRUE, 'Public broadcaster'),
  ('cbc.ca',             'CBC News',                    'CA', 'TRUSTED', 0.60, TRUE,  TRUE, TRUE, 'Public broadcaster'),
  ('npr.org',            'NPR',                         'US', 'TRUSTED', 0.60, TRUE,  TRUE, TRUE, 'Public broadcaster'),
  ('theguardian.com',    'The Guardian',                'GB', 'TRUSTED', 0.60, TRUE,  TRUE, TRUE, 'Daily newspaper'),

  -- Daily newspapers and business press (not breaking-cleared)
  ('nytimes.com',        'The New York Times',          'US', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('washingtonpost.com', 'The Washington Post',         'US', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('wsj.com',            'The Wall Street Journal',     'US', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Business daily'),
  ('ft.com',             'Financial Times',             'GB', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Business daily'),
  ('bloomberg.com',      'Bloomberg',                   'US', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Business news'),
  ('cnbc.com',          'CNBC',                         'US', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Business news'),
  ('economist.com',      'The Economist',               'GB', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Weekly analysis'),
  ('telegraph.co.uk',    'The Telegraph',               'GB', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('independent.co.uk',  'The Independent',             'GB', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('thetimes.co.uk',     'The Times',                   'GB', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('lemonde.fr',         'Le Monde',                    'FR', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('spiegel.de',         'Der Spiegel',                 'DE', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'News magazine'),
  ('elpais.com',         'El Pais',                     'ES', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('nikkei.com',         'Nikkei',                      'JP', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Business daily'),
  ('japantimes.co.jp',   'The Japan Times',             'JP', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('scmp.com',           'South China Morning Post',    'HK', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('thehindu.com',       'The Hindu',                   'IN', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('indianexpress.com',  'The Indian Express',          'IN', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('timesofindia.indiatimes.com', 'The Times of India', 'IN', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('premiumtimesng.com', 'Premium Times',               'NG', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('punchng.com',        'The Punch',                   'NG', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('nation.africa',      'Nation',                      'KE', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('news24.com',         'News24',                      'ZA', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('folha.uol.com.br',   'Folha de S.Paulo',            'BR', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('clarin.com',         'Clarin',                      'AR', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('eluniversal.com.mx', 'El Universal',                'MX', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('straitstimes.com',   'The Straits Times',           'SG', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('smh.com.au',         'The Sydney Morning Herald',   'AU', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('nzherald.co.nz',     'The New Zealand Herald',      'NZ', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('haaretz.com',        'Haaretz',                     'IL', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('arabnews.com',       'Arab News',                   'SA', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('thenationalnews.com','The National',                'AE', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Daily newspaper'),
  ('politico.com',       'Politico',                    'US', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Politics'),
  ('axios.com',          'Axios',                       'US', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'General news'),
  ('theatlantic.com',    'The Atlantic',                'US', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Magazine'),
  ('nature.com',         'Nature',                      'GB', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Peer-reviewed science'),
  ('science.org',        'Science',                     'US', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Peer-reviewed science'),
  ('scientificamerican.com','Scientific American',      'US', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Science magazine'),
  ('newscientist.com',   'New Scientist',               'GB', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Science magazine'),
  ('arstechnica.com',    'Ars Technica',                'US', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Technology'),
  ('theverge.com',       'The Verge',                   'US', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Technology'),
  ('wired.com',          'Wired',                       'US', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Technology'),
  ('espn.com',           'ESPN',                        'US', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Sport'),
  ('skysports.com',      'Sky Sports',                  'GB', 'TRUSTED', 0.60, FALSE, TRUE, TRUE, 'Sport'),

  -- LIMITED: real newsrooms whose output is aggregation-heavy or
  -- syndication-heavy. They surface, but score lower and never as BREAKING.
  ('yahoo.com',          'Yahoo News',                  NULL, 'LIMITED', 0.65, FALSE, TRUE, TRUE, 'Syndication-heavy aggregator'),
  ('msn.com',            'MSN',                         NULL, 'LIMITED', 0.65, FALSE, TRUE, TRUE, 'Syndication-heavy aggregator'),
  ('news.google.com',    'Google News',                 NULL, 'LIMITED', 0.65, FALSE, TRUE, TRUE, 'Aggregator'),

  -- BLOCKED: not news surfaces. Listed explicitly so link shorteners and
  -- user-content platforms cannot arrive via a provider's domain field and be
  -- presented to users as a publisher.
  ('bit.ly',             'Bitly (link shortener)',      NULL, 'BLOCKED', 1.00, FALSE, FALSE, TRUE, 'Link shortener; obscures destination'),
  ('tinyurl.com',        'TinyURL (link shortener)',    NULL, 'BLOCKED', 1.00, FALSE, FALSE, TRUE, 'Link shortener; obscures destination'),
  ('t.co',               't.co (link shortener)',       NULL, 'BLOCKED', 1.00, FALSE, FALSE, TRUE, 'Link shortener; obscures destination'),
  ('medium.com',         'Medium',                      NULL, 'BLOCKED', 1.00, FALSE, FALSE, TRUE, 'Open publishing platform; no editorial control'),
  ('substack.com',       'Substack',                    NULL, 'BLOCKED', 1.00, FALSE, FALSE, TRUE, 'Open publishing platform; no editorial control'),
  ('blogspot.com',       'Blogspot',                    NULL, 'BLOCKED', 1.00, FALSE, FALSE, TRUE, 'Open publishing platform; no editorial control'),
  ('wordpress.com',      'WordPress.com',               NULL, 'BLOCKED', 1.00, FALSE, FALSE, TRUE, 'Open publishing platform; no editorial control'),
  ('reddit.com',         'Reddit',                      NULL, 'BLOCKED', 1.00, FALSE, FALSE, TRUE, 'User-generated content'),
  ('facebook.com',       'Facebook',                    NULL, 'BLOCKED', 1.00, FALSE, FALSE, TRUE, 'User-generated content'),
  ('x.com',              'X',                           NULL, 'BLOCKED', 1.00, FALSE, FALSE, TRUE, 'User-generated content'),
  ('twitter.com',        'Twitter',                     NULL, 'BLOCKED', 1.00, FALSE, FALSE, TRUE, 'User-generated content'),
  ('youtube.com',        'YouTube',                     NULL, 'BLOCKED', 1.00, FALSE, FALSE, TRUE, 'User-generated content'),
  ('tiktok.com',         'TikTok',                      NULL, 'BLOCKED', 1.00, FALSE, FALSE, TRUE, 'User-generated content')
-- Re-running the migration must not silently revert an operator's audited
-- trust decision made through the admin API, so existing rows are left alone.
ON CONFLICT (canonical_domain) DO NOTHING;

-- Supports the durable-store reads behind Home's Live Updates / Spotlight
-- rails and the World News list, which filter on lifecycle state and order by
-- publication time. The v1.0 indexes cover (country, published_at) and
-- (category, published_at) but not the unfiltered "latest published" scan.
CREATE INDEX IF NOT EXISTS idx_home_news_articles_live
  ON home_news_articles (published_at DESC)
  WHERE lifecycle_state IN ('PUBLISHED','UPDATED','CORRECTED');

-- The publisher purge on a BLOCKED trust change filters by publisher_domain.
CREATE INDEX IF NOT EXISTS idx_home_news_articles_publisher
  ON home_news_articles (publisher_domain, published_at DESC);

-- The cache prune deletes by stale_until.
CREATE INDEX IF NOT EXISTS idx_home_news_cache_entries_stale
  ON home_news_cache_entries (stale_until);
