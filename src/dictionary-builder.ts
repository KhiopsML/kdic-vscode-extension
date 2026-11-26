/**
 * Creating a dictionary from a data file: the Khiops scenario that builds it, and the safe publication
 * of the result, which never leaves a partial file nor touches an existing one when the run fails.
 *
 * Free of any VS Code dependency.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execKhiops, withTemporaryDirectory, type KhiopsProcessResult, type Trace } from './khiops-runner';
import { khiopsErrorMessages } from './khiops-validation';

const CREATION_TIMEOUT_MS = 120_000;

/** How a creation ended. On failure, `reason` says why, and `errors` holds the errors Khiops printed. */
export type DictionaryCreationResult =
  | { ok: true }
  | { ok: false; reason: string; output: string; errors: string[] };

function failure(reason: string, output = '', errors: string[] = []): DictionaryCreationResult {
  return { ok: false, reason, output, errors };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Why none of `paths` can go in a Khiops scenario, which has one command per line, or undefined when
 * they all can.
 */
export function scenarioPathProblem(...paths: string[]): string | undefined {
  return paths.some(value => /[\r\n]/.test(value))
    ? 'Paths containing a carriage return or line feed cannot be used in a Khiops scenario.'
    : undefined;
}

/** Returns the dictionary path beside a source data file. */
export function dictionaryPathFor(source: string): string {
  const extension = path.extname(source);
  return source.slice(0, source.length - extension.length) + '.kdic';
}

/** Builds the Khiops scenario that creates a dictionary from a data table. */
export function buildCreationScenario(source: string, destination: string, headerLineUsed: boolean): string {
  return [
    'ClassManagement.ManageClasses',
    'BuildClassDefButton',
    `SourceDataTable.DatabaseSpec.Data.DatabaseName ${source}`,
    `SourceDataTable.DatabaseSpec.Data.HeaderLineUsed ${headerLineUsed}`,
    'BuildClassDef',
    'OK',
    'Exit',
    `ClassFileName ${destination}`,
    'OK',
    'Exit',
    'Exit',
    'OK',
  ].join('\n');
}

/**
 * Why a run did not produce a usable dictionary, or undefined when it did.
 * A process that did not start or was killed comes first, then the errors Khiops printed
 * (whatever the exit status), then a failing exit status, then a missing dictionary file.
 */
function runFailure(run: KhiopsProcessResult, dictionary: string): DictionaryCreationResult | undefined {
  const { output, error } = run;
  const errors = khiopsErrorMessages(output);
  if (error && (error.killed || typeof error.code !== 'number')) {
    return failure(`Khiops could not complete: ${error.message}`, output, errors);
  }
  if (errors.length) { return failure('Khiops reported errors.', output, errors); }
  if (error) { return failure(`Khiops exited unsuccessfully: ${error.message}`, output); }
  if (!fs.existsSync(dictionary)) { return failure('Khiops did not produce a dictionary.', output); }
  return undefined;
}

/**
 * Replaces `destination` by `dictionary`. The copy goes through a staging folder beside the destination
 * and is renamed over it, so a failure at any step leaves an existing destination as it was.
 */
function publish(dictionary: string, destination: string): Promise<void> {
  return withTemporaryDirectory(path.dirname(destination), '.kdic-create-', async staging => {
    const staged = path.join(staging, 'dictionary.kdic');
    fs.copyFileSync(dictionary, staged, fs.constants.COPYFILE_EXCL);
    if (fs.existsSync(destination)) { fs.accessSync(destination, fs.constants.W_OK); }
    fs.renameSync(staged, destination);
  });
}

/** Builds in a temporary directory, then replaces the destination only on success. */
export async function createDictionary(
  binary: string, source: string, destination: string, headerLineUsed: boolean, trace: Trace,
): Promise<DictionaryCreationResult> {
  const problem = scenarioPathProblem(source, destination, os.tmpdir());
  if (problem) { return failure(problem); }

  try {
    return await withTemporaryDirectory(os.tmpdir(), 'kdic-create-', async directory => {
      const dictionary = path.join(directory, 'dictionary.kdic');
      trace(`[Khiops] Source: ${source}`);
      trace(`[Khiops] Destination: ${destination}`);
      const scenario = buildCreationScenario(source, dictionary, headerLineUsed);
      const run = await execKhiops(binary, directory, scenario, CREATION_TIMEOUT_MS, trace);

      const failed = runFailure(run, dictionary);
      if (failed) { return failed; }
      try {
        await publish(dictionary, destination);
        return { ok: true };
      } catch (error) {
        return failure(`Unable to create dictionary ${destination}: ${errorText(error)}`, run.output);
      }
    });
  } catch (error) {
    return failure(`Unable to create dictionary ${destination}: ${errorText(error)}`);
  }
}
