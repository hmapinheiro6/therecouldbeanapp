-- Story publication timestamps are retained with source provenance. Catalog discovery
-- means our actual observation/verification, never the story or repository creation date.
UPDATE products SET first_seen_at=last_verified_at
WHERE canonical_url='https://pizza.hertzbeat.com' AND first_seen_at<last_verified_at;
