'use strict';

const { parseCsv, toCsv } = require('./csv');

const DEFAULT_PATTERN = '^[a-z0-9]+(_[a-z0-9]+)*$';
const DEFAULT_DEAD_DAYS = 90;

function splitTags(cell) {
  if (!cell) return [];
  return String(cell)
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseTicketCsv(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((c) => c.trim().toLowerCase());
  const idIdx = header.indexOf('id');
  const tagsIdx = header.indexOf('tags');
  const dateIdx = header.indexOf('created_at');
  if (idIdx === -1 || tagsIdx === -1 || dateIdx === -1) {
    throw new Error('Ticket CSV must have id, tags and created_at columns.');
  }
  const tickets = [];
  for (const cells of rows.slice(1)) {
    tickets.push({
      id: (cells[idIdx] || '').trim(),
      tags: splitTags(cells[tagsIdx] || ''),
      createdAt: (cells[dateIdx] || '').trim(),
    });
  }
  return tickets;
}

function separatorKey(tag) {
  return String(tag).toLowerCase().replace(/[\s-]+/g, '_');
}

function singularKey(tag) {
  let k = separatorKey(tag);
  if (k.endsWith('ies') && k.length > 3) k = k.slice(0, -3) + 'y';
  else if (/(ses|xes|zes|ches|shes)$/.test(k)) k = k.slice(0, -2);
  else if (k.endsWith('s') && !k.endsWith('ss') && k.length > 3) k = k.slice(0, -1);
  return k;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 1) return 2;
  const prev = Array.from({ length: n + 1 }, (_, j) => j);
  const cur = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j += 1) prev[j] = cur[j];
  }
  return prev[n];
}

class UnionFind {
  constructor(items) {
    this.parent = new Map(items.map((i) => [i, i]));
  }

  find(x) {
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur);
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

function parseDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function analyzeTickets(tickets, options) {
  const opts = options || {};
  const patternSource = opts.pattern || DEFAULT_PATTERN;
  const pattern = new RegExp(patternSource);
  const deadDays = typeof opts.deadDays === 'number' ? opts.deadDays : DEFAULT_DEAD_DAYS;

  // Frequency counts tickets, not raw repeats inside one ticket.
  const stats = new Map();
  let latest = null;
  for (const ticket of tickets) {
    const date = parseDate(ticket.createdAt);
    if (date && (!latest || date > latest)) latest = date;
    for (const tag of new Set(ticket.tags)) {
      if (!stats.has(tag)) stats.set(tag, { tag, count: 0, lastUsed: null });
      const s = stats.get(tag);
      s.count += 1;
      if (date && (!s.lastUsed || date > s.lastUsed)) s.lastUsed = date;
    }
  }

  const referenceDate = opts.referenceDate ? parseDate(opts.referenceDate) : latest;
  const tags = [...stats.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag)
  );
  for (const t of tags) {
    t.lastUsedIso = t.lastUsed ? t.lastUsed.toISOString().slice(0, 10) : '';
    t.ageDays =
      t.lastUsed && referenceDate
        ? Math.floor((referenceDate - t.lastUsed) / 86400000)
        : null;
    t.dead = t.ageDays !== null && t.ageDays > deadDays;
    t.oneOff = t.count === 1;
    t.violates = !pattern.test(t.tag);
  }

  // Clustering with union-find over the distinct tag set.
  const names = tags.map((t) => t.tag);
  const uf = new UnionFind(names);
  const bySep = new Map();
  const bySingular = new Map();
  for (const name of names) {
    const sk = separatorKey(name);
    if (bySep.has(sk)) uf.union(bySep.get(sk), name);
    else bySep.set(sk, name);
    const pk = singularKey(name);
    if (bySingular.has(pk)) uf.union(bySingular.get(pk), name);
    else bySingular.set(pk, name);
  }
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = names[i].toLowerCase();
      const b = names[j].toLowerCase();
      if (a.length >= 4 && b.length >= 4 && levenshtein(a, b) === 1) {
        uf.union(names[i], names[j]);
      }
    }
  }
  const clusterMap = new Map();
  for (const name of names) {
    const root = uf.find(name);
    if (!clusterMap.has(root)) clusterMap.set(root, []);
    clusterMap.get(root).push(name);
  }
  const clusters = [];
  for (const members of clusterMap.values()) {
    if (members.length < 2) continue;
    const sorted = members
      .map((m) => stats.get(m))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    clusters.push({
      canonical: sorted[0].tag,
      members: sorted.map((s) => ({ tag: s.tag, count: s.count })),
    });
  }
  clusters.sort((a, b) => a.canonical.localeCompare(b.canonical));

  const mergePlan = [];
  for (const cluster of clusters) {
    for (const member of cluster.members) {
      if (member.tag === cluster.canonical) continue;
      mergePlan.push({
        oldTag: member.tag,
        canonicalTag: cluster.canonical,
        affectedTickets: member.count,
      });
    }
  }
  mergePlan.sort((a, b) => a.oldTag.localeCompare(b.oldTag));

  return {
    ticketCount: tickets.length,
    tagCount: tags.length,
    referenceDate: referenceDate ? referenceDate.toISOString().slice(0, 10) : '',
    patternSource,
    deadDays,
    tags,
    clusters,
    mergePlan,
    violations: tags.filter((t) => t.violates),
    deadTags: tags.filter((t) => t.dead),
    oneOffTags: tags.filter((t) => t.oneOff),
  };
}

function mergePlanCsv(result) {
  const rows = [['old_tag', 'canonical_tag', 'affected_tickets']];
  for (const m of result.mergePlan) rows.push([m.oldTag, m.canonicalTag, m.affectedTickets]);
  return toCsv(rows);
}

function renderReport(result) {
  const lines = [];
  lines.push('# Tag Report');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('- Tickets analysed: ' + result.ticketCount);
  lines.push('- Distinct tags: ' + result.tagCount);
  lines.push('- Reference date (latest ticket, unless configured): ' + result.referenceDate);
  lines.push('- Near-duplicate clusters: ' + result.clusters.length);
  lines.push('- Merge plan rows: ' + result.mergePlan.length);
  lines.push('- Convention violations: ' + result.violations.length);
  lines.push('- Dead tags (unused for more than ' + result.deadDays + ' days): ' + result.deadTags.length);
  lines.push('- One-off tags (used on a single ticket): ' + result.oneOffTags.length);
  lines.push('- Naming pattern: `' + result.patternSource + '`');
  lines.push('');
  lines.push('## Frequency and recency');
  lines.push('');
  lines.push('| Tag | Tickets | Last used | Days since last use |');
  lines.push('| --- | --- | --- | --- |');
  for (const t of result.tags) {
    lines.push('| ' + t.tag + ' | ' + t.count + ' | ' + t.lastUsedIso + ' | ' + (t.ageDays === null ? '' : t.ageDays) + ' |');
  }
  lines.push('');
  lines.push('## Near-duplicate clusters');
  lines.push('');
  if (result.clusters.length === 0) lines.push('None.');
  else {
    for (const c of result.clusters) {
      lines.push(
        '- Canonical: ' + c.canonical + '. Members: ' +
          c.members.map((m) => m.tag + ' (' + m.count + ')').join(', ')
      );
    }
  }
  lines.push('');
  lines.push('## Convention violations');
  lines.push('');
  if (result.violations.length === 0) lines.push('None.');
  else {
    for (const t of result.violations) lines.push('- ' + t.tag + ' (' + t.count + ' tickets)');
  }
  lines.push('');
  lines.push('## Dead tags');
  lines.push('');
  if (result.deadTags.length === 0) lines.push('None.');
  else {
    for (const t of result.deadTags) {
      lines.push('- ' + t.tag + ', last used ' + t.lastUsedIso + ' (' + t.ageDays + ' days before the reference date)');
    }
  }
  lines.push('');
  lines.push('## One-off tags');
  lines.push('');
  if (result.oneOffTags.length === 0) lines.push('None.');
  else {
    lines.push(result.oneOffTags.map((t) => t.tag).join(', '));
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  DEFAULT_PATTERN,
  DEFAULT_DEAD_DAYS,
  splitTags,
  parseTicketCsv,
  separatorKey,
  singularKey,
  levenshtein,
  analyzeTickets,
  mergePlanCsv,
  renderReport,
};
