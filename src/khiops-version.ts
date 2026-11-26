/**
 * The version of the Khiops executable, compared with the one the built-in language support follows.
 *
 * Free of any VS Code dependency.
 */
import { execKhiopsProcess, type Trace } from './khiops-runner';

/**
 * The Khiops version documented on khiops.org, which the rule catalogue and the built-in checks follow
 * (see "Khiops version of reference" in `.github/copilot-instructions.md`).
 */
export const KHIOPS_REFERENCE_VERSION = '11.0.2';

/** Checks the version of a Khiops executable, warning the user when it is not the reference one. */
export type KhiopsVersionCheck = (binary: string) => Promise<void>;

export type KhiopsVersionResult =
  | { ok: true; version: string; output: string }
  | { ok: false; reason: string; output: string };

const VERSION_TIMEOUT_MS = 5_000;
/** `Khiops -v` prints a few lines: a much longer output is not a version. */
const VERSION_MAX_OUTPUT = 64 * 1024;

/** The dot-separated identifiers of a semantic version's pre-release and build parts. */
const IDENTIFIERS = '[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*';
/** A line holding only `Khiops <major.minor.patch[-prerelease][+build]>`, whose group 1 is the version. */
const VERSION_LINE = new RegExp(
  `^[ \\t]*Khiops[ \\t]+(\\d+\\.\\d+\\.\\d+(?:-${IDENTIFIERS})?(?:\\+${IDENTIFIERS})?)[ \\t]*$`,
);

/** Reads the full version of the executable (`-v`), without running a batch scenario. */
export async function readKhiopsVersion(binary: string, trace: Trace): Promise<KhiopsVersionResult> {
  trace(`[Khiops] Running: ${binary} -v`);
  const { stdout, stderr, error } = await execKhiopsProcess(binary, ['-v'], {
    timeout: VERSION_TIMEOUT_MS, maxBuffer: VERSION_MAX_OUTPUT, killSignal: 'SIGKILL',
  });
  const output = [stdout, stderr].filter(Boolean).join('\n');
  trace(`[Khiops] Version output:\n${output}`);

  if (error) {
    const reason = error.killed ? `Version command timed out or was killed: ${error.message}` : error.message;
    trace(`[Khiops] Version detection failed: ${reason}`);
    return { ok: false, reason, output };
  }

  // The version may be printed on either stream, or on both.
  const versions = new Set(output.split(/\r?\n/).flatMap(line => VERSION_LINE.exec(line)?.[1] ?? []));
  if (versions.size !== 1) {
    return { ok: false, reason: 'Version output contains no unambiguous supported Khiops version.', output };
  }
  return { ok: true, version: [...versions][0], output };
}

/** The warning to show for a version that is not the reference one, or undefined when it is. */
export function versionWarning(result: KhiopsVersionResult): string | undefined {
  if (!result.ok) { return 'The Khiops version could not be determined. The requested operation will continue.'; }
  if (result.version === KHIOPS_REFERENCE_VERSION) { return undefined; }
  return `Khiops ${result.version} differs from the extension's reference version ${KHIOPS_REFERENCE_VERSION}. `
    + 'Built-in language support follows the reference documentation. The requested operation will continue.';
}
