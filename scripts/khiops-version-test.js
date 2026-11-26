#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readKhiopsVersion } = require('../out/khiops-runner');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kdic-version-'));
  const binary = path.join(directory, process.platform === 'win32' ? 'mock version.cmd' : 'mock version');
  const script = path.join(directory, 'version.js');
  const data = path.join(directory, 'result.json');
  const write = value => fs.writeFileSync(data, JSON.stringify(value));
  fs.writeFileSync(script, `
const fs = require('fs');
const result = JSON.parse(fs.readFileSync(${JSON.stringify(data)}, 'utf8'));
if (process.argv.slice(2).join(' ') !== '-v') process.exit(2);
if (process.env.KHIOPS_PROC_NUMBER !== '1') process.exit(3);
if (result.slow) {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else {
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  process.exitCode = result.status || 0;
}
`);
  fs.writeFileSync(binary, process.platform === 'win32'
    ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
    : `#!/bin/sh\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${script.replace(/'/g, "'\\''")}' "$@"\n`,
  { mode: 0o755 });
  const read = () => readKhiopsVersion(binary, () => {});
  try {
    for (const version of ['11.0.2', '10.3.2', '11.0.3', '12.0.0', '11.0.3-a.0', '11.0.2+custom', '11.0.2-a.0+build.1']) {
      write({ stdout: ` \tKhiops ${version} \t\r\n` });
      const result = await read();
      assert.strictEqual(result.ok, true, JSON.stringify(result));
      assert.strictEqual(result.version, version);
    }
    write({ stdout: 'Khiops 11.0.2', stderr: 'Khiops 11.0.2\n' });
    assert.strictEqual((await read()).version, '11.0.2');
    write({ stderr: 'Khiops 11.0.3-a.0\n' });
    assert.strictEqual((await read()).version, '11.0.3-a.0');
    for (const stdout of ['', '11.0.2', '/data/Khiops 11.0.2', 'Khiops 11.0', 'Khiops 11.0.2 extra',
      'Khiops 11.0.2\nKhiops 11.0.3', 'Khiops 11.0.2-', 'Khiops 11.0.2+']) {
      write({ stdout });
      const result = await read();
      assert.strictEqual(result.ok, false, stdout);
      assert.ok(result.reason);
      assert.strictEqual(result.output, stdout);
    }
    write({ stdout: 'Khiops 11.0.2\n', stderr: 'probe failed', status: 1 });
    const failed = await read();
    assert.strictEqual(failed.ok, false);
    assert.match(failed.output, /probe failed/);
    assert.ok(failed.reason);
    assert.strictEqual((await readKhiopsVersion(path.join(directory, 'missing'), () => {})).ok, false);

    write({ stdout: 'x'.repeat(70 * 1024) });
    assert.strictEqual((await read()).ok, false, 'Oversized output must fail');
    // A POSIX exec wrapper ensures the timeout kills the process holding the pipes.
    if (process.platform !== 'win32') {
      write({ slow: true });
      const start = Date.now();
      const timeout = await read();
      const elapsed = Date.now() - start;
      assert.strictEqual(timeout.ok, false);
      assert.match(timeout.reason, /timed out/);
      assert.ok(elapsed >= 4900 && elapsed < 6500, `Version timeout took ${elapsed} ms`);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  console.log('Khiops version tests passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
