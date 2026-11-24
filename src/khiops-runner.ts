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

const IS_WINDOWS = process.platform === 'win32';

/** Name of the Khiops executable on this platform. */
const BINARY_NAME = IS_WINDOWS ? 'MODL.exe' : process.platform === 'darwin' ? 'MODL' : 'MODL_openmpi';

/** Where the Khiops installers put the executable on macOS and Linux (Windows uses KHIOPS_HOME). */
const DEFAULT_LOCATION = process.platform === 'darwin'
  ? '/Applications/Khiops.app/Contents/Resources/bin/MODL'
  : process.platform === 'linux' ? '/usr/bin/MODL_openmpi' : undefined;

const RUN_TIMEOUT_MS = 30_000;

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

/**
 * Lets Khiops parse a dictionary file and returns everything it printed
 * (standard output, standard error, and the error log on Windows).
 * Resolves to `undefined` when Khiops could not even be started.
 */
export function runKhiops(binary: string, dictionaryPath: string, trace: Trace): Promise<string | undefined> {
  const scenarioFile = path.join(os.tmpdir(), `kdic-check-${process.pid}.prm`);
  // Windows cannot write the log to /dev/stdout, so it goes to a file that is read back.
  const logFile = path.join(os.tmpdir(), `kdic-check-${process.pid}.out`);
  const removeQuietly = (file: string): void => { try { fs.unlinkSync(file); } catch { /* already gone */ } };

  try {
    fs.writeFileSync(scenarioFile, buildCheckScenario(dictionaryPath), 'utf-8');
    if (IS_WINDOWS) { fs.rmSync(logFile, { force: true }); }
  } catch {
    return Promise.resolve(undefined);
  }

  const args = ['-b', '-i', scenarioFile, '-e', IS_WINDOWS ? logFile : '/dev/stdout'];
  trace(`[Khiops] Running: ${binary} ${args.join(' ')}`);
  trace(`[Khiops] Dictionary: ${dictionaryPath}`);

  const options: cp.ExecFileOptions = { timeout: RUN_TIMEOUT_MS, env: { ...process.env, KHIOPS_PROC_NUMBER: '1' } };
  let command = binary;
  if (IS_WINDOWS && path.extname(binary).toLowerCase() === '.cmd') {
    // .cmd files need a shell, and a path with spaces must then be quoted.
    options.shell = true;
    if (binary.includes(' ')) { command = `"${binary}"`; }
  }

  return new Promise(resolve => {
    cp.execFile(command, args, options, (error, stdout, stderr) => {
      let logOutput = '';
      if (IS_WINDOWS) {
        try { logOutput = fs.readFileSync(logFile, 'utf-8'); }
        catch { trace(`[Khiops] Could not read output file: ${logFile}`); }
        removeQuietly(logFile);
      }
      removeQuietly(scenarioFile);

      if (error) { trace(`[Khiops] Process error: ${error.message}`); }
      const output = `${stdout?.toString() ?? ''}${stderr?.toString() ?? ''}${logOutput}`;
      trace(output.trim() ? `[Khiops] Output:\n${output}` : '[Khiops] No output captured (exit ok, no errors)');
      resolve(output);
    });
  });
}
