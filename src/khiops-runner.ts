/**
 * Running the native Khiops parser: locating the executable and loading a
 * dictionary file through a one-shot batch scenario.
 *
 * Free of any VS Code dependency; callers pass in the settings and a trace function.
 */
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Receives debug messages (a no-op unless the user enabled debug traces). */
export type Trace = (message: string) => void;

export const KHIOPS_REFERENCE_VERSION = '11.0.2';
export type KhiopsVersionCheck = (binary: string) => Promise<void>;

const IS_WINDOWS = process.platform === 'win32';

/** Name of the Khiops executable on this platform. */
const BINARY_NAME = IS_WINDOWS ? 'MODL.exe' : process.platform === 'darwin' ? 'MODL' : 'MODL_openmpi';

/** Where the Khiops installers put the executable on macOS and Linux (Windows uses KHIOPS_HOME). */
const DEFAULT_LOCATION = process.platform === 'darwin'
  ? '/Applications/Khiops.app/Contents/Resources/bin/MODL'
  : process.platform === 'linux' ? '/usr/bin/MODL_openmpi' : undefined;

const RUN_TIMEOUT_MS = 30_000;

function launchOptions(binary: string, timeout: number): { command: string; options: cp.ExecFileOptions } {
  const options: cp.ExecFileOptions = { timeout, env: { ...process.env, KHIOPS_PROC_NUMBER: '1' } };
  let command = binary;
  if (IS_WINDOWS && path.extname(binary).toLowerCase() === '.cmd') {
    options.shell = true;
    if (binary.includes(' ')) { command = `"${binary}"`; }
  }
  return { command, options };
}

export type KhiopsVersionResult =
  | { ok: true; version: string; output: string }
  | { ok: false; reason: string; output: string };

/** Reads the selected executable's full version without running a batch scenario. */
export async function readKhiopsVersion(binary: string, trace: Trace): Promise<KhiopsVersionResult> {
  const { command, options } = launchOptions(binary, 5_000);
  options.maxBuffer = 64 * 1024;
  options.killSignal = 'SIGKILL';
  trace(`[Khiops] Running: ${binary} -v`);
  try {
    return await new Promise<KhiopsVersionResult>(resolve => {
      cp.execFile(command, ['-v'], options, (error, stdout, stderr) => {
        const output = [stdout?.toString(), stderr?.toString()].filter(Boolean).join('\n');
        trace(`[Khiops] Version output:\n${output}`);
        if (error) {
          const reason = error.killed ? `Version command timed out or was killed: ${error.message}` : error.message;
          trace(`[Khiops] Version detection failed: ${reason}`);
          resolve({ ok: false, reason, output });
          return;
        }
        const pattern = /^[ \t]*Khiops[ \t]+(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)[ \t]*$/;
        const versions = new Set(output.split(/\r?\n/).flatMap(line => {
          const match = pattern.exec(line);
          return match ? [match[1]] : [];
        }));
        if (versions.size !== 1) {
          resolve({ ok: false, reason: 'Version output contains no unambiguous supported Khiops version.', output });
          return;
        }
        resolve({ ok: true, version: [...versions][0], output });
      });
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    trace(`[Khiops] Version detection failed: ${reason}`);
    return { ok: false, reason, output: '' };
  }
}

/**
 * Finds the Khiops executable.
 *
 * A non-empty `explicitPath` (the `kdic.khiopsPath` setting) is used alone: it may be
 * the executable or the directory containing it, and no other location is tried if
 * it does not resolve. Otherwise the platform's default locations are checked.
 */
export function findKhiopsBinary(explicitPath: string, trace: Trace): string | undefined {
  const explicit = explicitPath.trim();
  trace(`[Khiops] kdic.khiopsPath = "${explicit}", KHIOPS_HOME = "${process.env['KHIOPS_HOME'] ?? ''}", expected binary = "${BINARY_NAME}"`);

  const candidates: string[] = [];
  if (explicit) {
    candidates.push(explicit, path.join(explicit, BINARY_NAME));
  } else {
    if (IS_WINDOWS && process.env['KHIOPS_HOME']) {
      candidates.push(path.join(process.env['KHIOPS_HOME'], 'bin', BINARY_NAME));
    }
    if (DEFAULT_LOCATION) { candidates.push(DEFAULT_LOCATION); }
  }

  const found = candidates.find(candidate => {
    trace(`[Khiops] Trying: ${candidate}`);
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  });
  trace(found ? `[Khiops] Found binary: ${found}` : '[Khiops] No binary found');
  return found;
}

/** A Khiops batch scenario that opens one dictionary file, which makes Khiops parse and check it, then quits. */
function buildCheckScenario(dictionaryPath: string): string {
  return [
    '// Auto-generated validation scenario',
    'ClassManagement.OpenFile       // Open...',
    '',
    '// -> Open',
    `ClassFileName ${dictionaryPath}        // Dictionary file`,
    'OK                             // Open',
    '// <- Open',
    '',
    'ClassManagement.Quit           // Quit',
    '// <- Khiops',
    '',
    '',
    '// -> Khiops',
    'OK                             // Yes',
    '// <- Khiops',
  ].join('\n');
}

export interface KhiopsProcessResult {
  output: string;
  error: cp.ExecFileException | null;
}

/** Runs a prepared scenario and captures the process output and failure, if any. */
export function execKhiops(
  binary: string, scenarioFile: string, logFile: string, timeoutMs: number, trace: Trace,
): Promise<KhiopsProcessResult> {
  const args = ['-b', '-i', scenarioFile, '-e', IS_WINDOWS ? logFile : '/dev/stdout'];
  trace(`[Khiops] Running: ${binary} ${args.join(' ')}`);

  const { command, options } = launchOptions(binary, timeoutMs);

  return new Promise(resolve => {
    cp.execFile(command, args, options, (error, stdout, stderr) => {
      let logOutput = '';
      if (IS_WINDOWS) {
        try { logOutput = fs.readFileSync(logFile, 'utf-8'); }
        catch { trace(`[Khiops] Could not read output file: ${logFile}`); }
      }

      if (error) { trace(`[Khiops] Process error: ${error.message}`); }
      const output = `${stdout?.toString() ?? ''}${stderr?.toString() ?? ''}${logOutput}`;
      trace(output.trim() ? `[Khiops] Output:\n${output}` : '[Khiops] No output captured');
      resolve({ output, error });
    });
  });
}

/**
 * Lets Khiops parse a dictionary file and returns everything it printed
 * (standard output, standard error, and the error log on Windows).
 * Resolves to `undefined` when Khiops could not even be started.
 */
export async function runKhiops(binary: string, dictionaryPath: string, trace: Trace): Promise<string | undefined> {
  const scenarioFile = path.join(os.tmpdir(), `kdic-check-${process.pid}.prm`);
  // Windows cannot write the log to /dev/stdout, so it goes to a file that is read back.
  const logFile = path.join(os.tmpdir(), `kdic-check-${process.pid}.out`);
  const removeQuietly = (file: string): void => { try { fs.unlinkSync(file); } catch { /* already gone */ } };

  try {
    fs.writeFileSync(scenarioFile, buildCheckScenario(dictionaryPath), 'utf-8');
    if (IS_WINDOWS) { fs.rmSync(logFile, { force: true }); }
  } catch {
    return undefined;
  }

  trace(`[Khiops] Dictionary: ${dictionaryPath}`);
  try {
    return (await execKhiops(binary, scenarioFile, logFile, RUN_TIMEOUT_MS, trace)).output;
  } finally {
    if (IS_WINDOWS) { removeQuietly(logFile); }
    removeQuietly(scenarioFile);
  }
}
