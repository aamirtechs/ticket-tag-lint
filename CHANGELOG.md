# Changelog

## 1.0.0

Initial release.

- Parses a ticket CSV with id, tags, and created_at columns. Tag cells may be space or comma separated.
- Computes tag frequency, last used recency, one-off tags, and dead tags against a configurable age in days.
- Clusters near-duplicate tags: case variants, underscore, space and hyphen variants, simple plurals, and edit distance 1 pairs.
- Checks tags against a configurable naming regex. Defaults to lowercase snake_case.
- Writes tag-report.md and tag-merge-plan.csv. The canonical tag in each cluster is the most frequent form.
