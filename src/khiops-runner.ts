/**
 * Running Khiops: locating the executable, running it, and loading a dictionary
 * file through a one-shot batch scenario (the native Khiops parser).
 *
 * Free of any VS Code dependency; callers pass in the settings and a trace function.
 */
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Receives debug messages (a no-op unless the user enabled debug traces). */
export type Trace = (message: string) => void;

const IS_WINDOWS = process.platform === 'win32';

/** Name of the Khiops executable on this platform. */
const BINARY_NAME = IS_WINDOWS ? 'MODL.exe' : process.platform === 'darwin' ? 'MODL' : 'MODL_openmpi';

/** Where the Khiops installers put the executable on macOS and Linux (Windows uses KHIOPS_HOME). */
const DEFAULT_LOCATION = process.platform === 'darwin'
  ? '/Applications/Khiops.app/Contents/Resources/bin/MODL'
  : process.platform === 'linux' ? '/usr/bin/MODL_openmpi' : undefined;

/** Time Khiops gets to parse a dictionary file before the run is abandoned. */
const RUN_TIMEOUT_MS = 30_000;

/** What a process printed, and how it ended (`error` is null when it exited with status 0). */
export interface ProcessResult {
  stdout: string;
  stderr: string;
  error: cp.ExecFileException | null;
}

/**
 * Runs the Khiops executable with `args` and waits for it to end. Never rejects: a process that cannot
 * be started comes back as `error`. `KHIOPS_PROC_NUMBER=1` keeps Khiops from starting parallel workers.
 */
export function execKhiopsProcess(binary: string, args: string[], options: cp.ExecFileOptions): Promise<ProcessResult> {
  const launch: cp.ExecFileOptions = { ...options, env: { ...process.env, KHIOPS_PROC_NUMBER: '1' } };
  let command = binary;
  if (IS_WINDOWS && path.extname(binary).toLowerCase() === '.cmd') { // a batch script needs a shell
    launch.shell = true;
    if (binary.includes(' ')) { command = `"${binary}"`; }
  }

  return new Promise(resolve => {
    try {
      cp.execFile(command, args, launch, (error, stdout, stderr) =>
        resolve({ stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '', error }));
    } catch (error) { // invalid arguments make `execFile` throw instead of calling back
      resolve({ stdout: '', stderr: '', error: error as cp.ExecFileException });
    }
  });
}

/** Runs `work` in a new temporary directory under `parent`, then removes the directory, whatever happens. */
export async function withTemporaryDirectory<T>(
  parent: string, prefix: string, work: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = fs.mkdtempSync(path.join(parent, prefix));
  try {
    return await work(directory);
  } finally {
    try { fs.rmSync(directory, { recursive: true, force: true }); }
    catch { /* best effort: a file still locked (Windows) must not turn a finished run into a failure */ }
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

/** Everything a batch run printed (standard output and error, plus the error log on Windows), and how it ended. */
export interface KhiopsProcessResult {
  output: string;
  error: cp.ExecFileException | null;
}

/** Runs a batch scenario: writes it to `directory`, which also receives Khiops' log, and runs Khiops on it. */
export async function execKhiops(
  binary: string, directory: string, scenario: string, timeoutMs: number, trace: Trace,
): Promise<KhiopsProcessResult> {
  const scenarioFile = path.join(directory, 'scenario.prm');
  // Windows cannot write the log to /dev/stdout, so it goes to a file that is read back.
  const logFile = path.join(directory, 'khiops.log');
  fs.writeFileSync(scenarioFile, scenario, 'utf-8');

  const args = ['-b', '-i', scenarioFile, '-e', IS_WINDOWS ? logFile : '/dev/stdout'];
  trace(`[Khiops] Running: ${binary} ${args.join(' ')}`);
  const { stdout, stderr, error } = await execKhiopsProcess(binary, args, { timeout: timeoutMs });

  let log = '';
  if (IS_WINDOWS) {
    try { log = fs.readFileSync(logFile, 'utf-8'); }
    catch { trace(`[Khiops] Could not read output file: ${logFile}`); }
  }
  if (error) { trace(`[Khiops] Process error: ${error.message}`); }
  const output = stdout + stderr + log;
  trace(output.trim() ? `[Khiops] Output:\n${output}` : '[Khiops] No output captured');
  return { output, error };
}

/**
 * Lets Khiops parse a dictionary file and returns everything it printed.
 * Resolves to `undefined` when the run could not even be set up (no temporary scenario file).
 */
export async function runKhiops(binary: string, dictionaryPath: string, trace: Trace): Promise<string | undefined> {
  trace(`[Khiops] Dictionary: ${dictionaryPath}`);
  try {
    return await withTemporaryDirectory(os.tmpdir(), 'kdic-check-', async directory =>
      (await execKhiops(binary, directory, buildCheckScenario(dictionaryPath), RUN_TIMEOUT_MS, trace)).output);
  } catch (error) {
    trace(`[Khiops] Could not run Khiops: ${String(error)}`);
    return undefined;
  }
}
