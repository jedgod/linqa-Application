/** US business days: Monday to Friday, excluding US federal holidays (with the usual weekend "observed" shifts). */

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = utc(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return utc(year, month, 1 + offset + (n - 1) * 7);
}

function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = utc(year, month + 1, 0);
  return utc(year, month, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7));
}

/** A fixed-date holiday that falls on Saturday is observed Friday; on Sunday, Monday. */
function observed(date: Date): Date {
  const day = date.getUTCDay();
  if (day === 6) return utc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate() - 1);
  if (day === 0) return utc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate() + 1);
  return date;
}

export function usFederalHolidays(year: number): Set<string> {
  return new Set([
    observed(utc(year, 1, 1)), nthWeekday(year, 1, 1, 3), nthWeekday(year, 2, 1, 3), lastWeekday(year, 5, 1),
    observed(utc(year, 6, 19)), observed(utc(year, 7, 4)), nthWeekday(year, 9, 1, 1), nthWeekday(year, 10, 1, 2),
    observed(utc(year, 11, 11)), nthWeekday(year, 11, 4, 4), observed(utc(year, 12, 25))
  ].map(ymd));
}

/** Calendar date (YYYY-MM-DD) in US Eastern time, where business days are counted. */
export function easternDate(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isBusinessDay(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const day = utc(y, m, d);
  return day.getUTCDay() !== 0 && day.getUTCDay() !== 6 && !usFederalHolidays(y).has(date);
}

/** The date (YYYY-MM-DD, US Eastern) that is `count` business days after `from`. The start day itself never counts. */
export function addBusinessDays(from: Date, count: number): string {
  if (!Number.isInteger(count) || count < 0) throw new Error("BUSINESS_DAYS_MUST_BE_A_NON_NEGATIVE_INTEGER");
  const [y, m, d] = easternDate(from).split("-").map(Number) as [number, number, number];
  let cursor = utc(y, m, d);
  let remaining = count;
  while (remaining > 0) {
    cursor = utc(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate() + 1);
    if (isBusinessDay(ymd(cursor))) remaining -= 1;
  }
  return ymd(cursor);
}
