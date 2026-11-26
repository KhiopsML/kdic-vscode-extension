import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execKhiops, type Trace } from './khiops-runner';
import { khiopsErrorMessages } from './khiops-validation';

const CREATION_TIMEOUT_MS = 120_000;

export interface DictionaryCreationResult {
  ok: boolean;
  errors: string[];
  output: string;
  reason?: string;
}

function failure(reason: string, output = '', errors: string[] = []): DictionaryCreationResult {
  return { ok: false, reason, output, errors };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

/** Builds in a temporary directory, then replaces the destination only on success. */
export async function createDictionary(
  binary: string, source: string, destination: string, headerLineUsed: boolean, trace: Trace,
): Promise<DictionaryCreationResult> {
  if ([source, destination, os.tmpdir()].some(value => /[\r\n]/.test(value))) {
    return failure('Paths containing a carriage return or line feed cannot be used in a Khiops scenario.');
  }

  let temporaryDirectory: string | undefined;
  let stagingDirectory: string | undefined;
  let output = '';
  let result: DictionaryCreationResult = failure('Khiops did not create a dictionary.');
  try {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kdic-create-'));
    const scenario = path.join(temporaryDirectory, 'create.prm');
    const log = path.join(temporaryDirectory, 'create.out');
    const dictionary = path.join(temporaryDirectory, 'dictionary.kdic');
    fs.writeFileSync(scenario, buildCreationScenario(source, dictionary, headerLineUsed), 'utf8');
    trace(`[Khiops] Source: ${source}`);
    trace(`[Khiops] Destination: ${destination}`);
    const process = await execKhiops(binary, scenario, log, CREATION_TIMEOUT_MS, trace);
    output = process.output;
    const errors = khiopsErrorMessages(process.output);
    if (process.error?.killed || (process.error && typeof process.error.code !== 'number')) {
      result = failure(`Khiops could not complete: ${process.error.message}`, process.output, errors);
    } else if (errors.length) {
      result = failure('Khiops reported errors.', process.output, errors);
    } else if (process.error) {
      result = failure(`Khiops exited unsuccessfully: ${process.error.message}`, process.output);
    } else if (!fs.existsSync(dictionary)) {
      result = failure('Khiops did not produce a dictionary.', process.output);
    } else {
      stagingDirectory = fs.mkdtempSync(path.join(path.dirname(destination), '.kdic-create-'));
      const stagedFile = path.join(stagingDirectory, 'dictionary.kdic');
      fs.copyFileSync(dictionary, stagedFile, fs.constants.COPYFILE_EXCL);
      if (fs.existsSync(destination)) {
        fs.accessSync(destination, fs.constants.W_OK);
      }
      fs.renameSync(stagedFile, destination);
      result = { ok: true, errors: [], output: process.output };
    }
  } catch (error) {
    result = failure(`Unable to create dictionary ${destination}: ${errorText(error)}`, output);
  } finally {
    for (const directory of [temporaryDirectory, stagingDirectory]) {
      if (!directory) { continue; }
      try {
        fs.rmSync(directory, { recursive: true, force: true });
      } catch (error) {
        const reason = `Unable to remove temporary directory ${directory}: ${errorText(error)}`;
        if (result.ok) {
          result.reason = reason;
        } else {
          result.reason = `${result.reason} ${reason}`;
        }
      }
    }
  }
  return result;
}
