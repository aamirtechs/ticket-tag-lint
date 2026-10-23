# Good First Issues

These are seeded starter issues for new contributors. Each one is self contained and needs no extra services.

## 1. Freshdesk tag export adapter

Freshdesk exports arrange ticket tags differently from the generic id, tags, created_at shape this tool reads today. Add an adapter that maps a synthetic Freshdesk style export into the internal ticket format, selected with an input format flag. Ship fixtures and tests for the adapter, and keep the default CSV path behaving exactly as it does now.

## 2. Tag co-occurrence report (tags that always appear together)

Some tag pairs are really one concept split in two, for example a product tag that never appears without a matching region tag. Add a section to the report that lists tag pairs which always, or almost always, appear on the same tickets, with the shared ticket count for each pair. Use a configurable support threshold so small exports do not produce noisy pair lists.

## 3. Allow-list and block-list config support

Teams often have a small set of legacy tags that must never be renamed, and a set of banned words that must never appear in a tag. Extend the config file with an allow list that exempts named tags from convention violations and merge suggestions, and a block list that flags any tag containing a listed word. Cover both lists with tests, including a tag that appears on both lists, and document which list wins.
