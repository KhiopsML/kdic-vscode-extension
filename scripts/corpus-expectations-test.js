#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const expectations = require('./corpus-expectations');

const { compare, hasDifferences, buildEntries } = expectations;

// ── compare ────────────────────────────────────────────────────────────────────────────────────────────────────
const expected = {
  'a.kdic': { khiops: 'rejects', diagnostics: ['1:1 error x', '2:1 warning y'] },
  'b.kdic': { khiops: 'accepts', diagnostics: ['3:1 error z'] },
  'c.kdic': { khiops: 'rejects', diagnostics: ['1:1 error w'] },
  'd.kdic': { khiops: 'rejects', diagnostics: ['1:1 error v'] },
};
const scanned = new Set(['a.kdic', 'b.kdic', 'c.kdic', 'e.kdic']); // d.kdic is not in this corpus
const actual = new Map([
  ['a.kdic', ['2:1 warning y', '1:1 error x']], // same diagnostics in another order
  ['b.kdic', ['3:1 error z', '4:1 error added']],
  ['e.kdic', ['1:1 error new']],
]);
const result = compare(expected, actual, scanned);
assert.deepStrictEqual(result.added, [{ file: 'e.kdic', diagnostics: ['1:1 error new'] }]);
assert.deepStrictEqual(result.changed, [{ file: 'b.kdic', extra: ['4:1 error added'], missing: [] }]);
assert.deepStrictEqual(result.gone, ['c.kdic'], 'a file of the corpus without diagnostics any more');
assert.deepStrictEqual(result.absent, ['d.kdic'], 'a file that is not in this corpus is not a difference');
assert.ok(hasDifferences(result));
assert.ok(!hasDifferences(compare({ 'd.kdic': expected['d.kdic'] }, new Map(), new Set())), 'only absent files: no difference');
assert.deepStrictEqual(compare(expected, new Map([['a.kdic', ['1:1 error x']]]), scanned).changed,
  [{ file: 'a.kdic', extra: [], missing: ['2:1 warning y'] }]);

// ── buildEntries: verdicts and notes are kept, new files are asked, other corpora's entries survive ──────────────
(async () => {
  const asked = [];
  const entries = await buildEntries(
    { ...expected, 'a.kdic': { khiops: 'rejects', note: 'on purpose', diagnostics: ['old'] } },
    actual, scanned, async file => { asked.push(file); return 'accepts'; });
  assert.deepStrictEqual(asked, ['e.kdic'], 'Khiops is only asked about the files it does not know');
  assert.deepStrictEqual(entries['a.kdic'], { khiops: 'rejects', note: 'on purpose', diagnostics: ['2:1 warning y', '1:1 error x'] });
  assert.deepStrictEqual(entries['e.kdic'], { khiops: 'accepts', diagnostics: ['1:1 error new'] });
  assert.ok(!('c.kdic' in entries), 'a file that no longer has diagnostics is dropped');
  assert.deepStrictEqual(entries['d.kdic'], expected['d.kdic'], 'an entry of a file outside this corpus is kept');
  assert.deepStrictEqual(Object.keys(entries), ['a.kdic', 'b.kdic', 'd.kdic', 'e.kdic'], 'sorted by path');

  // ── the command line ───────────────────────────────────────────────────────────────────────────────────────────
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kdic-corpus-'));
  try {
    fs.mkdirSync(path.join(directory, 'sub'));
    fs.writeFileSync(path.join(directory, 'ok.kdic'), 'Dictionary D\n{\n Categorical c;\n};\n');
    fs.writeFileSync(path.join(directory, 'sub', 'bad.kdic'), 'Dictionary D\n{\n Categorical 1bad;\n};\n');
    const smoke = (...args) => spawnSync(process.execPath, [path.join(__dirname, 'smoke-test.js'), ...args], { encoding: 'utf8' });
    const expectedFile = path.join(directory, 'expected.json');
    const write = files => fs.writeFileSync(expectedFile, JSON.stringify({ files }));

    write({ 'sub/bad.kdic': { khiops: 'rejects', diagnostics: ['3:14 error Invalid variable name.'] } });
    let run = smoke('--expected', expectedFile, directory);
    assert.strictEqual(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /Same diagnostics as/);

    write({ 'sub/bad.kdic': { khiops: 'rejects', diagnostics: [] }, 'ok.kdic': { khiops: 'accepts', diagnostics: ['1:1 error stale'] } });
    run = smoke(directory, '--expected', expectedFile); // the directory may come before the option
    assert.strictEqual(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, /changed {2}sub\/bad\.kdic/);
    assert.match(run.stdout, /gone {5}ok\.kdic/);

    write({});
    run = smoke('--expected', expectedFile, directory);
    assert.strictEqual(run.status, 1);
    assert.match(run.stdout, /new {6}sub\/bad\.kdic/);

    for (const args of [['--expected'], ['--expected', expectedFile, '--update-expected', expectedFile], ['--errors-only', '--expected', expectedFile],
      ['--expected', path.join(directory, 'missing.json'), directory]]) {
      assert.strictEqual(smoke(...args).status, 2, args.join(' '));
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  console.log('Corpus expectations tests passed.');
})().catch(error => { console.error(error); process.exit(1); });
