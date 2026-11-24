#!/usr/bin/env node
// Runs the built-in KDIC validator on every .kdic file under a directory and
// reports the diagnostics. It uses the compiled modules, i.e. exactly the
// validation and derivation rules of the extension (run `npm run compile` first).
//
// Usage:
//   node scripts/smoke-test.js [directory]          # default: ~/Dev/LearningTest
//   node scripts/smoke-test.js --errors-only [dir]  # leave warnings out
//
// Exit status: 0 = no error, 1 = errors reported, 2 = bad setup (not compiled, missing directory).
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const out = path.join(__dirname, '..', 'out');
if (!fs.existsSync(path.join(out, 'validator.js'))) {
  console.error('Compiled validator not found. Run `npm run compile` first.');
  process.exit(2);
}
const { validate } = require(path.join(out, 'validator.js'));
const { buildRuleMaps } = require(path.join(out, 'rule-maps.js'));
const { DERIVATION_RULES } = require(path.join(out, 'derivation-rules.js'));
const { KdicTextDocument } = require(path.join(out, 'kdic-text-document.js'));

const ERROR = 0; // Severity.Error
const rules = buildRuleMaps(DERIVATION_RULES);

const args = process.argv.slice(2);
const errorsOnly = args.includes('--errors-only');
const directoryArg = args.find(arg => !arg.startsWith('--'));
const targetDir = directoryArg
  ? directoryArg.replace(/^~/, os.homedir())
  : path.join(os.homedir(), 'Dev', 'LearningTest');

/** All `.kdic` files under a directory, recursively. */
function findKdicFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { return findKdicFiles(full); }
    return entry.isFile() && entry.name.endsWith('.kdic') ? [full] : [];
  });
}

/** Diagnostics of one file; an unreadable file counts as a single error. */
function diagnosticsOf(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return [{ line: 0, col: 0, severity: ERROR, message: `Cannot read file: ${error.message}` }];
  }
  const diagnostics = validate(new KdicTextDocument(text), rules);
  return errorsOnly ? diagnostics.filter(d => d.severity === ERROR) : diagnostics;
}

console.log(`Rules loaded     : ${DERIVATION_RULES.length} derivation rules`);
console.log(`Target directory : ${targetDir}\n`);
if (!fs.existsSync(targetDir)) {
  console.error(`Directory not found: ${targetDir}`);
  process.exit(2);
}

const files = findKdicFiles(targetDir);
console.log(`Found ${files.length} .kdic files — validating…\n`);

const hasError = diagnostics => diagnostics.some(d => d.severity === ERROR);
const reports = files.map(file => ({ file, diagnostics: diagnosticsOf(file) })).filter(r => r.diagnostics.length > 0);

// Files with errors first, then alphabetically.
reports.sort((a, b) => hasError(b.diagnostics) - hasError(a.diagnostics) || a.file.localeCompare(b.file));
for (const { file, diagnostics } of reports) {
  console.log(path.relative(targetDir, file));
  for (const d of diagnostics) {
    console.log(`  ${d.severity === ERROR ? 'error  ' : 'warning'}  ${d.line + 1}:${d.col + 1}  ${d.message}`);
  }
}

const count = (predicate) => reports.flatMap(r => r.diagnostics).filter(predicate).length;
const errorFiles = reports.filter(r => hasError(r.diagnostics)).length;
const totalErrors = count(d => d.severity === ERROR);
const totalWarnings = count(d => d.severity !== ERROR);

console.log('─'.repeat(60));
console.log(`Files   : ${files.length} total — ${files.length - reports.length} clean, ${reports.length - errorFiles} warnings only, ${errorFiles} errors`);
console.log(`Issues  : ${totalErrors} errors, ${totalWarnings} warnings`);
if (totalErrors === 0 && totalWarnings === 0) { console.log('\nAll files passed with no issues.'); }
process.exit(totalErrors > 0 ? 1 : 0);
