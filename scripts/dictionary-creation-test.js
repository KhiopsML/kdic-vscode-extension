#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildCreationScenario, createDictionary, dictionaryPathFor } = require('../out/dictionary-builder');

for (const [source, expected] of [
  ['Adult.txt', 'Adult.kdic'],
  ['my.data.csv', 'my.data.kdic'],
  ['census', 'census.kdic'],
]) {
  assert.strictEqual(dictionaryPathFor(path.join('data', source)), path.join('data', expected));
}

for (const header of [true, false]) {
  const scenario = buildCreationScenario('/data with spaces/my data.txt', '/tmp with spaces/result.kdic', header);
  const lines = scenario.split('\n');
  assert.ok(lines.includes('SourceDataTable.DatabaseSpec.Data.DatabaseName /data with spaces/my data.txt'));
  assert.ok(lines.includes('ClassFileName /tmp with spaces/result.kdic'));
  assert.ok(lines.indexOf(`SourceDataTable.DatabaseSpec.Data.HeaderLineUsed ${header}`) < lines.indexOf('BuildClassDef'));
  assert.ok(lines.includes(`SourceDataTable.DatabaseSpec.Data.HeaderLineUsed ${header}`));
}

async function testCreation() {
  if (process.platform === 'win32') { return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kdic-builder-test-'));
  const tmp = path.join(root, 'tmp');
  const binary = path.join(root, 'mock-khiops');
  const marker = path.join(root, 'runs');
  const source = path.join(root, 'source.txt');
  const destination = path.join(root, 'source.kdic');
  const oldTmpdir = process.env.TMPDIR;
  const oldMode = process.env.KDIC_TEST_MODE;
  fs.mkdirSync(tmp);
  fs.writeFileSync(source, 'a\tb\n1\t2\n');
  fs.writeFileSync(binary, `#!/usr/bin/env node
const fs = require('fs');
const scenario = fs.readFileSync(process.argv[4], 'utf8');
fs.appendFileSync(${JSON.stringify(marker)}, 'run\\n');
const target = scenario.split('\\n').find(line => line.startsWith('ClassFileName ')).slice('ClassFileName '.length);
const mode = process.env.KDIC_TEST_MODE;
if (mode !== 'missing') fs.writeFileSync(target, 'Dictionary Mock { Categorical value; };\\n');
if (mode === 'error0' || mode === 'error1') console.log('Khiops.log\\terror : mock error');
if (mode === 'error1' || mode === 'exit1') process.exitCode = 1;
`, { mode: 0o755 });
  process.env.TMPDIR = tmp;

  const run = (src = source, dest = destination) => createDictionary(binary, src, dest, true, () => {});
  const assertClean = () => {
    assert.deepStrictEqual(fs.readdirSync(tmp), []);
    assert.ok(!fs.readdirSync(root).some(name => name.startsWith('.kdic-create-')));
  };
  try {
    process.env.KDIC_TEST_MODE = 'success';
    const success = await run();
    assert.strictEqual(success.ok, true, success.reason);
    assert.match(fs.readFileSync(destination, 'utf8'), /Dictionary Mock/);
    assertClean();

    for (const mode of ['error0', 'error1', 'exit1', 'missing']) {
      fs.writeFileSync(destination, 'original');
      process.env.KDIC_TEST_MODE = mode;
      const result = await run();
      assert.strictEqual(result.ok, false, mode);
      if (mode.startsWith('error')) { assert.deepStrictEqual(result.errors, ['mock error']); }
      assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'original', mode);
      assertClean();
    }

    const count = fs.readFileSync(marker, 'utf8');
    for (const [src, dest] of [[`${source}\nignored`, destination], [source, `${destination}\rignored`]]) {
      const result = await run(src, dest);
      assert.strictEqual(result.ok, false);
      assert.match(result.reason, /line feed/);
      assert.strictEqual(fs.readFileSync(marker, 'utf8'), count);
      assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'original');
      assertClean();
    }

    const readonly = path.join(root, 'readonly');
    fs.mkdirSync(readonly);
    fs.chmodSync(readonly, 0o555);
    try {
      process.env.KDIC_TEST_MODE = 'success';
      const result = await run(source, path.join(readonly, 'new.kdic'));
      assert.strictEqual(result.ok, false);
      assert.match(result.reason, /readonly/);
      assert.deepStrictEqual(fs.readdirSync(readonly), []);
      assertClean();
    } finally {
      fs.chmodSync(readonly, 0o755);
    }
  } finally {
    if (oldTmpdir === undefined) { delete process.env.TMPDIR; } else { process.env.TMPDIR = oldTmpdir; }
    if (oldMode === undefined) { delete process.env.KDIC_TEST_MODE; } else { process.env.KDIC_TEST_MODE = oldMode; }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

testCreation().then(() => console.log('Dictionary creation tests passed.'), error => {
  console.error(error);
  process.exitCode = 1;
});
