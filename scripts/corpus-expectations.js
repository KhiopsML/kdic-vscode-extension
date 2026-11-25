'use strict';
// The known state of a corpus (such as LearningTest) for the smoke test: for every file that has diagnostics,
// the exact diagnostics, whether Khiops itself rejects the file, and a free note. The paths are relative to
// the corpus directory, so the file can be kept in this repository while the corpus stays elsewhere.

const fs = require('fs');

const ERROR = 0; // Severity.Error
// The Khiops runner gives up after 30 s: a run that long says nothing about the file.
const KHIOPS_GIVE_UP_MS = 29_000;

const ABOUT = 'Known diagnostics of the corpus given to scripts/smoke-test.js, by path relative to it. '
  + '"khiops" tells whether the Khiops binary itself accepts or rejects the file ("unknown" when it could not be run); '
  + '"note" is free text. Check with --expected <this file>, regenerate with --update-expected <this file>: '
  + 'the verdicts and notes already here are kept.';

/** `line:col severity message`, as the smoke test prints a diagnostic. */
const formatDiagnostic = diagnostic =>
  `${diagnostic.line + 1}:${diagnostic.col + 1} ${diagnostic.severity === ERROR ? 'error' : 'warning'} ${diagnostic.message}`;

/** The entries of an expectations file by relative path; none when it does not exist and `optional` is set. */
function loadExpected(file, optional = false) {
  if (optional && !fs.existsSync(file)) { return {}; }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed.files !== 'object') { throw new Error(`${file}: no "files" table`); }
  return parsed.files;
}

const sorted = list => [...list].sort();
function sameList(a, b) {
  if (a.length !== b.length) { return false; }
  const other = sorted(b);
  return sorted(a).every((item, index) => item === other[index]);
}

/**
 * Compares what the validator reports (`actual`: relative path -> formatted diagnostics, files with some only)
 * with the expected entries. `scanned` holds every file of the corpus, to tell a file that no longer has
 * diagnostics from one that is not in this corpus.
 */
function compare(expected, actual, scanned) {
  const result = { added: [], changed: [], gone: [], absent: [] };
  for (const [file, diagnostics] of actual) {
    const known = expected[file]?.diagnostics;
    if (!known) { result.added.push({ file, diagnostics }); continue; }
    if (sameList(known, diagnostics)) { continue; }
    result.changed.push({
      file,
      extra: diagnostics.filter(item => !known.includes(item)),
      missing: known.filter(item => !diagnostics.includes(item)),
    });
  }
  for (const file of Object.keys(expected)) {
    if (!actual.has(file)) { (scanned.has(file) ? result.gone : result.absent).push(file); }
  }
  return result;
}

/** Whether there is a difference that makes the check fail. */
const hasDifferences = result => result.added.length + result.changed.length + result.gone.length > 0;

/** Prints the differences found by `compare`. */
function printDifferences(result, log = console.log) {
  for (const { file, diagnostics } of result.added) {
    log(`new      ${file}`);
    diagnostics.forEach(item => log(`           + ${item}`));
  }
  for (const { file, extra, missing } of result.changed) {
    log(`changed  ${file}`);
    extra.forEach(item => log(`           + ${item}`));
    missing.forEach(item => log(`           - ${item}`));
  }
  for (const file of result.gone) { log(`gone     ${file} (no diagnostics any more)`); }
  if (result.absent.length) { log(`${result.absent.length} expected file(s) are not in this corpus, ignored.`); }
}

/**
 * The entries for `actual`: the verdict and note already known for a file are kept, a new file gets the
 * verdict of `verdictOf(path)`. Entries of files that are not in this corpus are kept as they are.
 */
async function buildEntries(previous, actual, scanned, verdictOf) {
  const files = {};
  for (const file of sorted([...actual.keys(), ...Object.keys(previous).filter(name => !scanned.has(name))])) {
    const old = previous[file];
    if (!actual.has(file)) { files[file] = old; continue; }
    files[file] = { khiops: old?.khiops ?? await verdictOf(file), ...(old?.note ? { note: old.note } : {}), diagnostics: actual.get(file) };
  }
  return files;
}

/** Writes an expectations file. */
function saveExpected(file, files) {
  fs.writeFileSync(file, `${JSON.stringify({ about: ABOUT, files }, null, 2)}\n`);
}

/** 'accepts' or 'rejects' for a dictionary file, 'unknown' if Khiops could not be started or took too long. */
async function khiopsVerdict(runKhiops, binary, file) {
  const started = Date.now();
  const output = await runKhiops(binary, file, () => {});
  if (output === undefined || Date.now() - started >= KHIOPS_GIVE_UP_MS) { return 'unknown'; }
  return /error\s*:/i.test(output) ? 'rejects' : 'accepts';
}

module.exports = { formatDiagnostic, loadExpected, compare, hasDifferences, printDifferences, buildEntries, saveExpected, khiopsVerdict };
