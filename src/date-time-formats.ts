/**
 * The external formats of dates and times that Khiops accepts in the `DateFormat`, `TimeFormat`,
 * `TimestampFormat` and `TimestampTZFormat` meta-data.
 * See https://khiops.org/api-docs/kdic/date-rules/ (and the time, timestamp and timestamp-tz pages).
 *
 * Free of any VS Code dependency.
 */

/** `Y`, `M` and `D` fields of a date, in the orders Khiops accepts. */
const DATE_ORDERS = [['YYYY', 'MM', 'DD'], ['DD', 'MM', 'YYYY'], ['YYYY', 'DD', 'MM'], ['MM', 'DD', 'YYYY']];
const DATE_SEPARATORS = ['-', '/', '.', ''];

/** `H`, `M` and `S` fields of a time, with the separator between them. A field in parentheses may drop its leading zero. */
const TIME_STYLES = [
  ['HH', 'MM', 'SS', ':'], ['HH', 'MM', 'SS', '.'], ['(H)H', '(M)M', '(S)S', ':'], ['(H)H', '(M)M', '(S)S', '.'],
  ['HH', 'MM', 'SS', ''],
];

/** Between the date and the time of a timestamp; nothing is allowed only when neither has a separator. */
const TIMESTAMP_SEPARATORS = [' ', '-', '_', 'T'];

/** Basic (`+hhmm`) and extended (`+hh:mm`) ISO 8601 time zone, after a timestamp. */
const TIME_ZONES = ['zzzzz', 'zzzzzz'];

interface Format {
  text: string;
  /** Whether the format has no separator character at all. */
  compact: boolean;
}

const dateFormats = (): Format[] => DATE_ORDERS.flatMap(order => DATE_SEPARATORS.map(separator => (
  { text: order.join(separator), compact: separator === '' }
)));

/** For each style: with seconds, with seconds and an optional fraction (a trailing `.`), and without seconds. */
const timeFormats = (): Format[] => TIME_STYLES.flatMap(([hour, minute, second, separator]) => {
  const hourMinute = hour + separator + minute;
  return [hourMinute + separator + second, `${hourMinute}${separator}${second}.`, hourMinute]
    .map(text => ({ text, compact: separator === '' }));
});

function timestampFormats(): string[] {
  const dates = dateFormats();
  const times = timeFormats();
  return dates.flatMap(date => times.flatMap(time => {
    const separators = date.compact && time.compact ? [...TIMESTAMP_SEPARATORS, ''] : TIMESTAMP_SEPARATORS;
    return separators.map(separator => date.text + separator + time.text);
  }));
}

/** Every valid format of each date or time type, built on first use. */
let formats: Readonly<Record<string, ReadonlySet<string>>> | undefined;

function allFormats(): Readonly<Record<string, ReadonlySet<string>>> {
  if (!formats) {
    const timestamps = timestampFormats();
    formats = {
      Date: new Set(dateFormats().map(format => format.text)),
      Time: new Set(timeFormats().map(format => format.text)),
      Timestamp: new Set(timestamps),
      TimestampTZ: new Set(timestamps.flatMap(timestamp => TIME_ZONES.map(zone => timestamp + zone))),
    };
  }
  return formats;
}

/** Every format Khiops accepts for a variable of type `type` (`Date`, `Time`, `Timestamp`, `TimestampTZ`). */
export function formatsOf(type: string): ReadonlySet<string> {
  return allFormats()[type] ?? new Set();
}

/** Whether `format` is a format Khiops accepts for a variable of type `type`. */
export function isValidFormat(type: string, format: string): boolean {
  return formatsOf(type).has(format);
}

/** The documentation page listing the formats of a type, for messages. */
export function formatDocumentationUrl(type: string): string {
  const pages: Readonly<Record<string, string>> = {
    Date: 'date-rules', Time: 'time-rules', Timestamp: 'timestamp-rules', TimestampTZ: 'timestamp-tz-rules',
  };
  return `https://khiops.org/api-docs/kdic/${pages[type]}/`;
}
