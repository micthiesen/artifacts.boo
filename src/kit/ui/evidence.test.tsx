// Evidence: citations number by file order, sources files are checked, and AsOf knows when a recheck is due.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, describe, expect, test } from "bun:test";

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const React = await import("react");
const { createRoot } = await import("react-dom/client");

/** Renders into the DOM and returns the markup (the kit's data hooks have no server snapshot). */
async function markup(node: React.ReactNode): Promise<string> {
  const el = document.createElement("div");
  const root = createRoot(el);
  await React.act(async () => root.render(node));
  const out = el.innerHTML;
  await React.act(async () => root.unmount());
  return out;
}
const store = await import("../store.ts");
const { AsOfImpl: AsOf, CiteImpl: Cite, ClaimImpl: Claim, SourcesImpl, checkSources, citeNumber, daysBetween, freshness, parseDay, relativeDay } = await import("./evidence-impl.tsx");

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 20));
  await GlobalRegistrator.unregister();
});

const sources = [
  { id: "ftc", title: "FTC notice", url: "https://www.ftc.gov/notice", checked: "2026-10-20", kind: "official" },
  { id: "reddit", title: "Thread on r/frugal", url: "https://reddit.com/r/frugal/x", kind: "forum" },
  { id: "mine", title: "What the owner told us", kind: "owner", note: "By phone" },
];
store.setBoot({ artifactId: "a", version: 1, entry: "@art/index.mdx", title: "t", data: { "data/sources.json": sources as never, "data/other.json": [sources[2]] as never } });

describe("citations", () => {
  test("a source's number is its place in the file, whichever is cited first", async () => {
    expect(citeNumber(sources, "reddit")).toBe(2);
    expect(citeNumber(sources, "ftc")).toBe(1);
    expect(citeNumber(sources, "nope")).toBe(0);
    const html = await markup(
      <p>
        A <Cite id="mine" /> B <Cite id="ftc" /> C <Cite id="mine" data="other.json" />
      </p>,
    );
    expect([...html.matchAll(/>\[(\d)\]</g)].map((m) => m[1])).toEqual(["3", "1", "1"]);
    expect(html).toContain('href="#source-mine"');
    expect(html).toContain('aria-label="Source 1: FTC notice"');
  });

  test("an unknown id or a missing file shows a visible marker instead of a broken link", async () => {
    const html = await markup(<Cite id="ghost" />);
    expect(html).toContain("[? ghost]");
    expect(html).toContain("No source &quot;ghost&quot; in sources.json");
    expect(html).not.toContain("href");
    expect(await markup(<Cite id="ftc" data="missing.json" />)).toContain("missing.json is missing");
  });

  test("the list numbers, links and labels each row, with an id to land on", async () => {
    const html = await markup(<SourcesImpl data="sources.json" title="Sources" open />);
    expect(html).toContain('id="source-ftc"');
    expect(html).toContain('id="source-mine"');
    expect(html).toContain(">2.</span>");
    expect(html).toContain('href="https://www.ftc.gov/notice"');
    expect(html).toContain("ftc.gov");
    expect(html).toContain(">Official<");
    expect(html).toContain(">Forum<");
    expect(html).toContain("By phone");
    // Closed, it is a <details> whose summary still says how many there are.
    const closed = await markup(<SourcesImpl data="sources.json" title="Sources" open={false} />);
    expect(closed).toContain("<details");
    expect(closed).not.toContain("<details open");
  });

  test("a sources file is checked: ids unique and fragment-safe, titles present, URLs http(s), dates ISO, kinds known", () => {
    expect(checkSources(sources)).toEqual([]);
    expect(checkSources({})).toHaveLength(1);
    const bad = checkSources([
      { id: "a", title: "A" },
      { id: "a", title: "Again" },
      { id: "has space", title: "B" },
      { id: "c", title: "" },
      { id: "d", title: "D", url: "ftp://x", checked: "last week", kind: "blog" },
    ]);
    expect(bad).toEqual([
      'source 2: id "a" is used twice',
      'source 3: "id" is 1-64 letters, digits, "-", "_" or "."',
      'source 4: "title" is missing',
      'source 5: "url" is an http(s) URL',
      'source 5: "checked" is an ISO date like 2026-10-28',
      'source 5: "kind" is one of primary, official, provider, report, forum, owner',
    ]);
  });
});

describe("AsOf", () => {
  const now = new Date(2026, 9, 28, 15, 30);

  test("a bare date is that day where the reader is", () => {
    const d = parseDay("2026-10-25")!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 25]);
    expect(parseDay("Oct 25")).toBeNull();
    expect(parseDay("2026-13-45")).toBeNull();
    expect(daysBetween(d, now)).toBe(3);
  });

  test("relative words by calendar day", () => {
    expect([0, 1, 3, 13, 14, 21, 59, 60, 200, 365, 800, -1, -5].map(relativeDay)).toEqual([
      "today",
      "yesterday",
      "3 days ago",
      "13 days ago",
      "2 weeks ago",
      "3 weeks ago",
      "8 weeks ago",
      "a month ago",
      "6 months ago",
      "a year ago",
      "2 years ago",
      "tomorrow",
      "in 5 days",
    ]);
  });

  test("due for a recheck from the day next names, not before", () => {
    expect(freshness("2026-10-25", undefined, now)!.due).toBe(false);
    expect(freshness("2026-10-01", "2026-10-29", now)!.due).toBe(false);
    expect(freshness("2026-10-01", "2026-10-28", now)!.due).toBe(true);
    expect(freshness("2026-09-01", "2026-10-01", now)!.due).toBe(true);
    expect(freshness("soon", undefined, now)).toBeNull();
  });

  test("renders relative and absolute dates visibly, and the warning in words once due", async () => {
    const fresh = await markup(<AsOf checked={new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10)} scope="prices" />);
    expect(fresh).toContain("3 days ago");
    expect(fresh).toContain("· prices");
    expect(fresh).not.toContain("Due for a recheck");
    const stale = await markup(<AsOf checked="2020-01-01" next="2020-02-01" />);
    expect(stale).toContain("Due for a recheck");
    expect(stale).toContain(parseDay("2020-01-01")!.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }));
    expect(await markup(<AsOf checked="yesterday" />)).toContain("[date?]");
  });
});

test("Claim says its status in words, with or without the claim's text", async () => {
  const html = await markup(
    <Claim status="inferred" note="from the invoice dates">
      Billing moved to monthly
    </Claim>,
  );
  expect(html).toContain("Billing moved to monthly");
  expect(html).toContain("Inferred");
  expect(html).toContain("from the invoice dates");
  expect(await markup(<Claim status="verified" />)).toContain("Verified");
  expect(await markup(<Claim status={"sure" as never} />)).toContain("[claim?]");
});

test("the inline wrappers load their bodies and keep the claim's text while they do", async () => {
  const { Cite: LazyCite, Claim: LazyClaim } = await import("./evidence.tsx");
  const el = document.createElement("div");
  const root = (await import("react-dom/client")).createRoot(el);
  await React.act(async () => root.render(<p><LazyClaim status="verified">Fees fell</LazyClaim> <LazyCite id="reddit" /></p>));
  await React.act(async () => new Promise((r) => setTimeout(r, 50)));
  expect(el.textContent).toContain("Fees fell");
  expect(el.textContent).toContain("Verified");
  expect(el.textContent).toContain("[2]");
  await React.act(async () => root.unmount());
});
