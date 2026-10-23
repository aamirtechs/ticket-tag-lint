'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  splitTags,
  parseTicketCsv,
  separatorKey,
  singularKey,
  levenshtein,
  analyzeTickets,
  mergePlanCsv,
} = require('../src/lint');

test('splitTags handles space and comma separated cells', () => {
  assert.deepEqual(splitTags('billing refund_request'), ['billing', 'refund_request']);
  assert.deepEqual(splitTags('billing, refund_request'), ['billing', 'refund_request']);
  assert.deepEqual(splitTags(''), []);
});

test('parseTicketCsv requires id, tags and created_at columns', () => {
  assert.throws(() => parseTicketCsv('id,tags\nT-1,billing\n'), /created_at/);
  const tickets = parseTicketCsv('id,tags,created_at\nT-1,"billing refund",2026-10-01\n');
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].createdAt, '2026-10-01');
});

test('frequency counts tickets and last used is the newest date', () => {
  const tickets = parseTicketCsv(
    'id,tags,created_at\nT-1,billing,2026-10-01\nT-2,billing,2026-10-05\nT-3,shipping,2026-10-03\n'
  );
  const r = analyzeTickets(tickets, { referenceDate: '2026-10-10' });
  const billing = r.tags.find((t) => t.tag === 'billing');
  assert.equal(billing.count, 2);
  assert.equal(billing.lastUsedIso, '2026-10-05');
  assert.equal(billing.ageDays, 5);
});

test('case, separator and plural variants cluster together', () => {
  assert.equal(separatorKey('Refund-Request'), 'refund_request');
  assert.equal(singularKey('refunds'), 'refund');
  assert.equal(singularKey('categories'), 'category');
  const tickets = parseTicketCsv(
    [
      'id,tags,created_at',
      'T-1,refund_request,2026-10-01',
      'T-2,refund_request,2026-10-02',
      'T-3,Refund-Request,2026-10-03',
      'T-4,refund_requests,2026-10-03',
      'T-5,refunds,2026-10-04',
      'T-6,refund,2026-10-04',
    ].join('\n')
  );
  const r = analyzeTickets(tickets);
  const cluster = r.clusters.find((c) => c.canonical === 'refund_request');
  assert.ok(cluster);
  assert.deepEqual(
    cluster.members.map((m) => m.tag).sort(),
    ['Refund-Request', 'refund_request', 'refund_requests']
  );
  const pluralCluster = r.clusters.find((c) => c.members.some((m) => m.tag === 'refunds'));
  assert.ok(pluralCluster);
  assert.deepEqual(
    pluralCluster.members.map((m) => m.tag).sort(),
    ['refund', 'refunds']
  );
});

test('edit distance 1 pairs cluster, distant tags do not', () => {
  assert.equal(levenshtein('login_issue', 'logn_issue'), 1);
  assert.ok(levenshtein('billing', 'shipping') > 1);
  const tickets = parseTicketCsv(
    'id,tags,created_at\nT-1,login_issue,2026-10-01\nT-2,login_issue,2026-10-02\nT-3,logn_issue,2026-10-03\n'
  );
  const r = analyzeTickets(tickets);
  assert.equal(r.clusters.length, 1);
  assert.equal(r.clusters[0].canonical, 'login_issue');
});

test('canonical pick is the most frequent form in the cluster', () => {
  const tickets = parseTicketCsv(
    'id,tags,created_at\nT-1,Billing,2026-10-01\nT-2,billing,2026-10-01\nT-3,billing,2026-10-02\nT-4,billing,2026-10-03\n'
  );
  const r = analyzeTickets(tickets);
  assert.equal(r.mergePlan.length, 1);
  assert.deepEqual(r.mergePlan[0], {
    oldTag: 'Billing',
    canonicalTag: 'billing',
    affectedTickets: 1,
  });
  assert.match(mergePlanCsv(r), /old_tag,canonical_tag,affected_tickets/);
});

test('convention checker flags tags outside the default snake_case pattern', () => {
  const tickets = parseTicketCsv(
    'id,tags,created_at\nT-1,"good_tag BadTag has-hyphen",2026-10-01\n'
  );
  const r = analyzeTickets(tickets);
  assert.deepEqual(r.violations.map((t) => t.tag).sort(), ['BadTag', 'has-hyphen']);
});

test('a custom pattern from config replaces the default', () => {
  const tickets = parseTicketCsv('id,tags,created_at\nT-1,has-hyphen,2026-10-01\n');
  const r = analyzeTickets(tickets, { pattern: '^[a-z]+(-[a-z]+)*$' });
  assert.equal(r.violations.length, 0);
});

test('dead tags and one-off tags are reported against the reference date', () => {
  const tickets = parseTicketCsv(
    [
      'id,tags,created_at',
      'T-1,old_tag,2026-01-01',
      'T-2,fresh_tag,2026-10-01',
      'T-3,fresh_tag,2026-10-02',
    ].join('\n')
  );
  const r = analyzeTickets(tickets, { referenceDate: '2026-10-10', deadDays: 90 });
  assert.deepEqual(r.deadTags.map((t) => t.tag), ['old_tag']);
  assert.deepEqual(r.oneOffTags.map((t) => t.tag), ['old_tag']);
});

test('CLI writes tag-report.md and tag-merge-plan.csv', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttl-'));
  const input = path.join(dir, 'tickets.csv');
  const out = path.join(dir, 'out');
  fs.writeFileSync(
    input,
    'id,tags,created_at\nT-1,billing,2026-10-01\nT-2,Billing,2026-10-02\n'
  );
  const stdout = execFileSync(
    process.execPath,
    [path.join(__dirname, '..', 'src', 'cli.js'), input, '--out-dir', out],
    { encoding: 'utf8' }
  );
  assert.match(stdout, /Distinct tags: 2/);
  assert.match(fs.readFileSync(path.join(out, 'tag-merge-plan.csv'), 'utf8'), /Billing,billing,1/);
  assert.match(fs.readFileSync(path.join(out, 'tag-report.md'), 'utf8'), /Tag Report/);
});
