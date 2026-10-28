// A page's sources (data/sources.json, shown by <Sources> and cited by <Cite>): their shape and the check the
// Worker runs on save, so a bad file is refused with a reason instead of rendering wrong.

export type SourceKind = "primary" | "official" | "provider" | "report" | "forum" | "owner";
export type Source = { id: string; title: string; url?: string; checked?: string; kind?: SourceKind; note?: string };

/** A source id becomes part of an element id (`source-<id>`), so it keeps to characters a URL fragment leaves alone. */
export const SOURCE_ID = /^[A-Za-z0-9_.-]{1,64}$/;

export const SOURCE_KINDS: Record<SourceKind, { label: string; tone: "positive" | "neutral" | "caution" }> = {
  primary: { label: "Primary", tone: "positive" },
  official: { label: "Official", tone: "positive" },
  provider: { label: "Provider", tone: "neutral" },
  report: { label: "Report", tone: "neutral" },
  forum: { label: "Forum", tone: "caution" },
  owner: { label: "Owner", tone: "neutral" },
};

/**
 * What's wrong with a sources file, as messages for whoever wrote it. Empty when it's fine. The Worker can run
 * this on save; the list shows the same messages if a bad file got through.
 */
export function checkSources(value: unknown): string[] {
  if (!Array.isArray(value)) return ["sources must be a list of {id, title, url?, checked?, kind?, note?}"];
  const out: string[] = [];
  const seen = new Set<string>();
  value.forEach((s, i) => {
    const at = `source ${i + 1}`;
    if (!s || typeof s !== "object" || Array.isArray(s)) return out.push(`${at} isn't an object`);
    const r = s as Record<string, unknown>;
    if (typeof r.id !== "string" || !SOURCE_ID.test(r.id)) out.push(`${at}: "id" is 1-64 letters, digits, "-", "_" or "."`);
    else if (seen.has(r.id)) out.push(`${at}: id "${r.id}" is used twice`);
    else seen.add(r.id);
    if (typeof r.title !== "string" || !r.title.trim()) out.push(`${at}: "title" is missing`);
    if (r.url !== undefined && (typeof r.url !== "string" || !/^https?:\/\/\S+$/.test(r.url))) out.push(`${at}: "url" is an http(s) URL`);
    if (r.checked !== undefined && parseDay(r.checked) === null) out.push(`${at}: "checked" is an ISO date like 2026-10-28`);
    if (r.kind !== undefined && !(typeof r.kind === "string" && r.kind in SOURCE_KINDS)) {
      out.push(`${at}: "kind" is one of ${Object.keys(SOURCE_KINDS).join(", ")}`);
    }
    if (r.note !== undefined && typeof r.note !== "string") out.push(`${at}: "note" is text`);
  });
  return out;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * An ISO date or timestamp as a time. A bare date ("2026-10-25") is that day where the reader is, not midnight
 * UTC, which would be the day before for everyone west of Greenwich.
 */
export function parseDay(iso: unknown): Date | null {
  if (typeof iso !== "string" || !ISO_DATE.test(iso.trim())) return null;
  const s = iso.trim();
  const [y, m, day] = [Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10))];
  const d = s.length === 10 ? new Date(y, m - 1, day) : new Date(s);
  // Date rolls 2026-02-30 over into March; a date that doesn't exist isn't one.
  if (!Number.isFinite(d.getTime()) || m < 1 || m > 12 || day < 1 || day > new Date(y, m, 0).getDate()) return null;
  return d;
}

