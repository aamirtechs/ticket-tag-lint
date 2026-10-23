#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseTicketCsv, analyzeTickets, mergePlanCsv, renderReport } = require('./lint');

function usage() {
  return [
    'Usage: ticket-tag-lint <tickets.csv> [--out-dir DIR] [--config config.json] [--dead-days 90] [--pattern REGEX] [--reference-date YYYY-MM-DD]',
    '',
    'Config JSON keys: pattern, deadDays, referenceDate.',
    'Writes tag-report.md and tag-merge-plan.csv into the output directory.',
  ].join('\n');
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(usage());
    return args.length === 0 ? 1 : 0;
  }
  let input = null;
  let outDir = '.';
  let config = {};
  const overrides = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--out-dir') outDir = args[++i];
    else if (args[i] === '--config') config = JSON.parse(fs.readFileSync(args[++i], 'utf8'));
    else if (args[i] === '--dead-days') overrides.deadDays = Number(args[++i]);
    else if (args[i] === '--pattern') overrides.pattern = args[++i];
    else if (args[i] === '--reference-date') overrides.referenceDate = args[++i];
    else if (!args[i].startsWith('--')) input = args[i];
    else throw new Error('Unknown option: ' + args[i]);
  }
  if (!input) throw new Error('Missing input CSV path.\n' + usage());
  const options = { ...config, ...overrides };
  const tickets = parseTicketCsv(fs.readFileSync(input, 'utf8'));
  const result = analyzeTickets(tickets, options);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'tag-report.md'), renderReport(result));
  fs.writeFileSync(path.join(outDir, 'tag-merge-plan.csv'), mergePlanCsv(result));
  console.log('Tickets analysed: ' + result.ticketCount);
  console.log('Distinct tags: ' + result.tagCount);
  console.log('Near-duplicate clusters: ' + result.clusters.length);
  console.log('Merge plan rows: ' + result.mergePlan.length);
  console.log('Convention violations: ' + result.violations.length);
  console.log('Dead tags: ' + result.deadTags.length);
  console.log('Wrote tag-report.md and tag-merge-plan.csv to ' + outDir);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv);
  } catch (err) {
    console.error('Error: ' + err.message);
    process.exitCode = 1;
  }
}

module.exports = { main };
