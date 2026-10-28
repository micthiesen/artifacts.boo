// The shortlist's save check and the order its rows are shown in.
import { expect, test } from "bun:test";
import { arrangeShortlist, checkShortlist, decisionChoices, type ShortlistData, type ShortlistOption } from "../src/shared/shortlist.ts";

const opt = (id: string, verdict: ShortlistOption["verdict"], extra: Partial<ShortlistOption> = {}): ShortlistOption => ({
  id,
  name: id.toUpperCase(),
  verdict,
  summary: `${id} in one sentence.`,
  url: `https://${id}.example`,
  ...extra,
});

const good = (): ShortlistData => ({
  question: "Which clinic for laser hair removal?",
  pick: "a",
  why: "Cheapest with a doctor on site.",
  checked: "2026-10-20",
  next: "2026-11-20",
  criteria: ["Safety", "Price"],
  options: [opt("a", "pick", { price: "€120", priceChecked: "2026-10-19" }), opt("b", "close"), opt("c", "no", { url: undefined })],
  decide: { options: "all" },
});

test("a well-formed shortlist passes", () => {
  expect(checkShortlist(good(), new Date(2026, 9, 28))).toEqual([]);
});

test("required fields and the object itself", () => {
  expect(checkShortlist(null)[0]).toContain("JSON object");
  const p = checkShortlist({ options: [] });
  expect(p.some((m) => m.startsWith(`"question" is required`))).toBe(true);
  expect(p.some((m) => m.startsWith(`"checked"`))).toBe(true);
  expect(p.some((m) => m.startsWith(`"options" lists 2 to 10`))).toBe(true);
});

test("dates are real ISO days, next on or after checked, nothing checked in the future", () => {
  expect(checkShortlist({ ...good(), checked: "2026-02-30" }).some((m) => m.includes("real date"))).toBe(true);
  expect(checkShortlist({ ...good(), checked: "Oct 20" }).some((m) => m.includes("YYYY-MM-DD"))).toBe(true);
  expect(checkShortlist({ ...good(), next: "2026-10-01" })).toContain(`"next" is on or after "checked": it's when to check again`);
  // Checking again the same day is fine.
  expect(checkShortlist({ ...good(), next: good().checked })).toEqual([]);
  const now = new Date(2026, 9, 28);
  expect(checkShortlist({ ...good(), checked: "2026-11-05", next: "2026-12-01" }, now).some((m) => m.includes("in the future"))).toBe(true);
  // Without a clock (the page), a future date isn't refused: the reader's clock isn't the writer's.
  expect(checkShortlist({ ...good(), checked: "2026-11-05", next: "2026-12-01" })).toEqual([]);
  const s = good();
  s.options[0]!.priceChecked = "2026-13-01";
  expect(checkShortlist(s).some((m) => m.startsWith(`option "a": "priceChecked"`))).toBe(true);
});

test("ids are unique and URL-safe", () => {
  const s = good();
  s.options[1]!.id = "a";
  expect(checkShortlist(s).some((m) => m.includes(`id "a" is used twice`))).toBe(true);
  s.options[1]!.id = "Clinic B";
  expect(checkShortlist(s).some((m) => m.includes("lowercase letters, digits"))).toBe(true);
});

test("verdicts are valid and the pick agrees with them", () => {
  const s = good();
  (s.options[1] as { verdict: string }).verdict = "maybe";
  expect(checkShortlist(s).some((m) => m.includes(`"verdict" is one of pick, close, conditional, no`))).toBe(true);

  const two = good();
  two.options[1]!.verdict = "pick";
  expect(checkShortlist(two).some((m) => m.startsWith("only one option has the verdict"))).toBe(true);

  const elsewhere = { ...good(), pick: "b" };
  expect(checkShortlist(elsewhere)).toContain(`option "b" is the "pick", so its "verdict" is "pick"`);

  expect(checkShortlist({ ...good(), pick: "zzz" }).some((m) => m.startsWith(`"pick" names an option id`))).toBe(true);
  expect(checkShortlist({ ...good(), why: undefined })).toContain(`"why" says in one sentence why "pick" is the one`);

  const unset = { ...good(), pick: undefined, why: undefined };
  expect(checkShortlist(unset)).toContain(`option "a" has the verdict "pick": set "pick" to "a" and say "why"`);
  // No pick at all is fine: the shortlist can leave the choice open.
  const open = { ...unset, options: [opt("a", "close"), opt("b", "conditional")] };
  expect(checkShortlist(open)).toEqual([]);
});

test("every option still in the running cites something; ruled-out ones needn't", () => {
  const s = good();
  s.options[1] = { ...s.options[1]!, url: undefined };
  expect(checkShortlist(s)).toContain(`option "b": add at least one "evidence" link or a "url", so the reader can check it`);
  s.options[1]!.evidence = [{ label: "Reviews", url: "https://reviews.example/b", kind: "forum" }];
  expect(checkShortlist(s)).toEqual([]);
});

test("links are http(s) and evidence kinds are the sources' kinds", () => {
  const s = good();
  s.options[0]!.url = "javascript:alert(1)";
  s.options[1]!.evidence = [{ label: "x", url: "ftp://x" }];
  const p = checkShortlist(s);
  expect(p).toContain(`option "a": "url" is an http(s) link to the option's own page`);
  expect(p).toContain(`option "b": each "evidence" item is {label, url} with an http(s) url`);
  const k = good();
  k.options[1]!.evidence = [{ label: "x", url: "https://x.example", kind: "blog" as never }];
  expect(checkShortlist(k).some((m) => m.includes(`evidence "kind" is one of primary, official`))).toBe(true);
});

test("phone-sized text: summary words, list lengths, option count", () => {
  const s = good();
  s.options[0]!.summary = Array(31).fill("word").join(" ");
  s.options[0]!.pros = ["a", "b", "c", "d", "e", "f"];
  s.options[0]!.cons = [Array(26).fill("w").join(" ")];
  const p = checkShortlist(s);
  expect(p.some((m) => m.includes(`"summary" has 31 words; keep it to 30`))).toBe(true);
  expect(p.some((m) => m.includes(`"pros" has 6 points`))).toBe(true);
  expect(p.some((m) => m.includes(`a point in "cons" has 26 words`))).toBe(true);
  const many = good();
  many.options = [opt("a", "pick"), ...Array.from({ length: 10 }, (_, i) => opt(`o${i}`, "close"))];
  expect(checkShortlist(many).some((m) => m.includes("has 11"))).toBe(true);
});

test("decide names real options", () => {
  expect(checkShortlist({ ...good(), decide: { options: ["a", "nope"] } })).toContain(`"decide.options" names "nope", which isn't an option id`);
  expect(checkShortlist({ ...good(), decide: { options: ["a"] } }).some((m) => m.includes("at least 2"))).toBe(true);
  expect(checkShortlist({ ...good(), decide: { id: "has space" } }).some((m) => m.startsWith(`"decide.id"`))).toBe(true);
});

test("rows rank by verdict, keep the file's order within one, and put ruled-out ones aside", () => {
  const options = [opt("x", "conditional"), opt("gone", "no"), opt("b", "close"), opt("a", "pick"), opt("c", "close"), opt("gone2", "no")];
  const { ranked, ruledOut } = arrangeShortlist(options);
  expect(ranked.map((r) => `${r.rank}:${r.option.id}`)).toEqual(["1:a", "2:b", "3:c", "4:x"]);
  expect(ruledOut.map((o) => o.id)).toEqual(["gone", "gone2"]);
});

test("the Decision offers what decide asks for", () => {
  const s = good();
  expect(decisionChoices(s)).toEqual([
    { value: "a", label: "A", detail: "€120" },
    { value: "b", label: "B" },
  ]);
  expect(decisionChoices({ ...s, decide: { options: ["c", "a"] } }).map((c) => c.value)).toEqual(["c", "a"]);
});
