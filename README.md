# ticket-tag-lint
Live page: https://aamirtechs.github.io/ticket-tag-lint/

Analyse a ticket export and expose tag sprawl: near-duplicate tags, one-off tags, dead tags and naming-convention violations, with a ready-to-apply merge plan that maps every messy tag to a canonical one.

## Why

Ticket tags drive routing, reporting, and automation, and they rot quietly. The same idea ends up as `refund_request`, `refund-request`, and `Refund_Request`, reports split the count three ways, and automations keyed on one spelling miss the other two. This tool reads a plain ticket export, clusters the near duplicates, names a canonical tag for each cluster, and hands back a merge plan a support ops lead can apply or hand to an admin.

## Install

Requires Node.js 20 or later. There are no dependencies.

```bash
git clone https://github.com/aamirtechs/ticket-tag-lint.git
cd ticket-tag-lint
node src/cli.js --help
```

You can also link the CLI globally from the cloned folder:

```bash
npm link
ticket-tag-lint tickets.csv --out-dir output
```

## Usage

```bash
node src/cli.js <tickets.csv> [--out-dir DIR] [--config config.json] [--dead-days 90] [--pattern REGEX] [--reference-date YYYY-MM-DD]
```

- Input is a ticket CSV with `id`, `tags`, and `created_at` columns. Inside the tags cell, tags may be space separated or comma separated (quote the cell when you use commas).
- Output is `tag-report.md` and `tag-merge-plan.csv` in the output directory.
- Config JSON keys are `pattern`, `deadDays`, and `referenceDate`. Command line flags override config values.
- The default naming pattern is lowercase snake_case, `^[a-z0-9]+(_[a-z0-9]+)*$`.
- The reference date defaults to the newest `created_at` in the export, so dead tag results are reproducible for a given file. Set it in config when you want a fixed "today".

### What it computes

- Frequency per tag, counted in tickets, plus the last date each tag was used.
- Near-duplicate clusters built from case variants, underscore, space and hyphen variants, simple plural forms, and edit distance 1 pairs. The canonical tag is the most frequent form in the cluster.
- Convention violations, meaning tags that do not match the configured pattern.
- Dead tags, unused for more than `deadDays` before the reference date. The default is 90 days.
- One-off tags, used on exactly one ticket.

## Example

Real input, from `examples/tickets.csv`:

```csv
id,tags,created_at
T-1001,"billing refund_request",2026-10-20
T-1002,"Billing refund-request",2026-10-19
T-1003,"billing refunds",2026-10-18
T-1004,"billing refund_request login_issue",2026-10-17
T-1005,"login-issue account_reset",2026-10-16
T-1006,"login_issue",2026-10-15
T-1007,"logn_issue VIP",2026-10-14
T-1008,"shipping delayed_shipment",2026-10-10
T-1009,"shipping",2026-09-28
T-1010,"legacy_fax_order",2026-01-05
T-1011,"one_time_glitch",2026-10-21
T-1012,"billing refund_request shipping",2026-10-21
```

The example config, from `examples/config.json`:

```json
{
  "pattern": "^[a-z0-9]+(_[a-z0-9]+)*$",
  "deadDays": 90,
  "referenceDate": "2026-10-22"
}
```

Real run:

```bash
node src/cli.js examples/tickets.csv --config examples/config.json --out-dir output
```

Real output:

```text
Tickets analysed: 12
Distinct tags: 14
Near-duplicate clusters: 3
Merge plan rows: 4
Convention violations: 4
Dead tags: 1
Wrote tag-report.md and tag-merge-plan.csv to output
```

The generated `tag-merge-plan.csv`:

```csv
old_tag,canonical_tag,affected_tickets
Billing,billing,1
login-issue,login_issue,1
logn_issue,login_issue,1
refund-request,refund_request,1
```

The generated `tag-report.md`:

```markdown
# Tag Report

## Summary

- Tickets analysed: 12
- Distinct tags: 14
- Reference date (latest ticket, unless configured): 2026-10-22
- Near-duplicate clusters: 3
- Merge plan rows: 4
- Convention violations: 4
- Dead tags (unused for more than 90 days): 1
- One-off tags (used on a single ticket): 10
- Naming pattern: `^[a-z0-9]+(_[a-z0-9]+)*$`

## Frequency and recency

| Tag | Tickets | Last used | Days since last use |
| --- | --- | --- | --- |
| billing | 4 | 2026-10-21 | 1 |
| refund_request | 3 | 2026-10-21 | 1 |
| shipping | 3 | 2026-10-21 | 1 |
| login_issue | 2 | 2026-10-17 | 5 |
| account_reset | 1 | 2026-10-16 | 6 |
| Billing | 1 | 2026-10-19 | 3 |
| delayed_shipment | 1 | 2026-10-10 | 12 |
| legacy_fax_order | 1 | 2026-01-05 | 290 |
| login-issue | 1 | 2026-10-16 | 6 |
| logn_issue | 1 | 2026-10-14 | 8 |
| one_time_glitch | 1 | 2026-10-21 | 1 |
| refund-request | 1 | 2026-10-19 | 3 |
| refunds | 1 | 2026-10-18 | 4 |
| VIP | 1 | 2026-10-14 | 8 |

## Near-duplicate clusters

- Canonical: billing. Members: billing (4), Billing (1)
- Canonical: login_issue. Members: login_issue (2), login-issue (1), logn_issue (1)
- Canonical: refund_request. Members: refund_request (3), refund-request (1)

## Convention violations

- Billing (1 tickets)
- login-issue (1 tickets)
- refund-request (1 tickets)
- VIP (1 tickets)

## Dead tags

- legacy_fax_order, last used 2026-01-05 (290 days before the reference date)

## One-off tags

account_reset, Billing, delayed_shipment, legacy_fax_order, login-issue, logn_issue, one_time_glitch, refund-request, refunds, VIP
```

Note that `refunds` sits in the one-off list but in no cluster. It is a plural of `refund`, and no plain `refund` tag exists in this export to merge it into.

## Library use

```js
const { parseTicketCsv, analyzeTickets, mergePlanCsv } = require('./src');

const tickets = parseTicketCsv('id,tags,created_at\nT-1,billing,2026-10-01\n');
const result = analyzeTickets(tickets, { deadDays: 90 });
console.log(mergePlanCsv(result));
```

## Tests

```bash
npm test
```

Tests use the built in Node.js test runner and cover tag splitting, frequency and recency, all four clustering rules, the canonical pick, convention checking with default and custom patterns, dead and one-off tags, and the CLI end to end.

## Contributing

See GFIs.md for seeded good first issues.

## License

MIT. Copyright (c) 2026 Amir Hussain. See LICENSE.
