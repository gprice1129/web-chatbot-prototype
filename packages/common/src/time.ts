export {
  parse_iso_date,
}

/*
 * Idea: Read a calendar date written as YYYY-MM-DD, and nothing else.
 *
 * (unknown) => Date | null
 * The text is read as a UTC midnight and written back out; only text that
 * survives the round trip unchanged was a real date in the one accepted shape.
 * Pure
 * Public
 */
function parse_iso_date(value: unknown): Date | null {
  const text = String(value);
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 10) !== text) return null;
  return date;
}
