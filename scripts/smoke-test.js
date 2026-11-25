#!/usr/bin/env node
// Runs the built-in KDIC validator on every .kdic file under a directory and
// reports the diagnostics. It uses the compiled modules, i.e. exactly the
// validation and derivation rules of the extension (run `npm run compile` first).
//
// Usage:
//   node scripts/smoke-test.js [directory]          # default: ~/Dev/LearningTest
//   node scripts/smoke-test.js --errors-only [dir]  # leave warnings out
//   node scripts/smoke-test.js --expected corpus-expectations.json [dir]
//       # compare with the known diagnostics of the corpus: report only what changed
//   node scripts/smoke-test.js --update-expected corpus-expectations.json [dir]
//       # rewrite that file from the current diagnostics; Khiops tells, for each new file, whether it rejects it
//
// Exit status: 0 = no error (with --expected: nothing changed), 1 = errors reported (with --expected: something
// changed), 2 = bad setup (not compiled, missing directory or file, wrong options).
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const expectations = require('./corpus-expectations');

const out = path.join(__dirname, '..', 'out');
if (!fs.existsSync(path.join(out, 'validator.js'))) {
  console.error('Compiled validator not found. Run `npm run compile` first.');
  process.exit(2);
}
const { validate } = require(path.join(out, 'validator.js'));
const { buildRuleMaps } = require(path.join(out, 'rule-maps.js'));
const { DERIVATION_RULES } = require(path.join(out, 'derivation-rules.js'));
const { KdicTextDocument } = require(path.join(out, 'kdic-text-document.js'));
const { findKhiopsBinary, runKhiops } = require(path.join(out, 'khiops-runner.js'));

const ERROR = 0; // Severity.Error
const rules = buildRuleMaps(DERIVATION_RULES);

const args = process.argv.slice(2);

/** Removes `name value` from the arguments and returns the value; stops if the value is missing. */
function takeOption(name) {
  const index = args.indexOf(name);
  if (index < 0) { return undefined; }
  const value = args.splice(index, 2)[1];
  if (value === undefined || value.startsWith('--')) { fail(`${name} needs a file.`); }
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

const expectedFile = takeOption('--expected');
const updateFile = takeOption('--update-expected');
const errorsOnly = args.includes('--errors-only');
const directoryArg = args.find(arg => !arg.startsWith('--'));
if (expectedFile && updateFile) { fail('--expected and --update-expected cannot be combined.'); }
if (errorsOnly && (expectedFile || updateFile)) { fail('--errors-only cannot be combined with --expected or --update-expected.'); }
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
if (!fs.existsSync(targetDir)) { fail(`Directory not found: ${targetDir}`); }
if (expectedFile && !fs.existsSync(expectedFile)) { fail(`File not found: ${expectedFile}`); }

const files = findKdicFiles(targetDir);
console.log(`Found ${files.length} .kdic files — validating…\n`);

const hasError = diagnostics => diagnostics.some(d => d.severity === ERROR);
const reports = files.map(file => ({ file, diagnostics: diagnosticsOf(file) })).filter(r => r.diagnostics.length > 0);
const relative = file => path.relative(targetDir, file).split(path.sep).join('/');

/** Prints every diagnostic, then the totals; 1 if there is an error. */
function printReport() {
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
  return totalErrors > 0 ? 1 : 0;
}

/** The formatted diagnostics of the files that have some, and the paths of every file of the corpus. */
const actual = new Map(reports.map(({ file, diagnostics }) => [relative(file), diagnostics.map(expectations.formatDiagnostic)]));
const scanned = new Set(files.map(relative));

/** --expected: prints what differs from the known diagnostics; 1 if anything does. */
function checkExpected() {
  let expected;
  try { expected = expectations.loadExpected(expectedFile); } catch (error) { fail(error.message); }
  const result = expectations.compare(expected, actual, scanned);
  expectations.printDifferences(result);
  const differences = expectations.hasDifferences(result);
  console.log('─'.repeat(60));
  console.log(differences
    ? `Differs from ${expectedFile}: ${result.added.length} new, ${result.changed.length} changed, ${result.gone.length} gone. `
      + 'Fix the regression, or accept the change with --update-expected.'
    : `Same diagnostics as ${expectedFile} (${actual.size} files with diagnostics out of ${files.length}).`);
  return differences ? 1 : 0;
}

/** --update-expected: rewrites the file; Khiops is asked about the files it does not know yet. */
async function updateExpectedFile() {
  let previous;
  try { previous = expectations.loadExpected(updateFile, true); } catch (error) { fail(error.message); }
  const binary = findKhiopsBinary('', () => {});
  if (!binary) { console.warn('Khiops not found: the new files get the verdict "unknown".'); }

  let asked = 0;
  const verdictOf = async file => {
    if (!binary) { return 'unknown'; }
    process.stdout.write(`\rAsking Khiops… ${++asked}`);
    return expectations.khiopsVerdict(runKhiops, binary, path.join(targetDir, file));
  };
  const entries = await expectations.buildEntries(previous, actual, scanned, verdictOf);
  expectations.saveExpected(updateFile, entries);

  const here = Object.entries(entries).filter(([file]) => actual.has(file));
  const verdicts = verdict => here.filter(([, entry]) => entry.khiops === verdict);
  console.log(`\nWrote ${updateFile}: ${here.length} files with diagnostics — Khiops rejects ${verdicts('rejects').length}, `
    + `accepts ${verdicts('accepts').length}, unknown ${verdicts('unknown').length}.`);
  const kept = Object.keys(entries).length - here.length;
  if (kept) { console.log(`${kept} entries of files that are not in this corpus were kept.`); }
  const falsePositives = verdicts('accepts').filter(([, entry]) => entry.diagnostics.some(item => /^\d+:\d+ error /.test(item)));
  if (falsePositives.length) {
    console.log(`\nErrors reported on files that Khiops accepts (${falsePositives.length}), to investigate:`);
    falsePositives.forEach(([file]) => console.log(`  ${file}`));
  }
  return 0;
}

(async () => {
  process.exit(expectedFile ? checkExpected() : updateFile ? await updateExpectedFile() : printReport());
})();
