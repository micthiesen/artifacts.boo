import { expect, test } from "bun:test";
import { buildArtifact, compileFile } from "../src/worker/compile.ts";

const files = new Set<string>(["app.tsx", "chart.tsx"]);

test("prose mentioning import/export is not treated as an import", async () => {
  const src = `import { Poll } from "@a/ui";
const notes = ["Import notes from Evernote", 'export "markdown" files'];
export default function App() { return <div>{notes.join(" ")}<Poll id="p" options={["a", "b"]} /></div>; }`;
  expect((await compileFile("app.tsx", src, files)).errors).toEqual([]);
  const mdx = `# Plan\n\nWe import "Notion" pages and export "PDF" files.\n\n<Checklist id="x" items={["Import data", "Export: \\"all\\""]} />\n`;
  expect((await compileFile("index.mdx", mdx, files)).errors).toEqual([]);
});

test("unused or type-only bad imports are still reported", async () => {
  const r = await compileFile("app.tsx", 'import x from "lodash";\nexport default () => <div />;', files);
  expect(r.errors[0]?.message).toContain('"lodash"');
  const dyn = await compileFile("app.tsx", 'export default () => { import("left-pad"); return null; };', files);
  expect(dyn.errors[0]?.message).toContain('"left-pad"');
});

test("relative imports resolve without extensions and are rewritten", async () => {
  const r = await buildArtifact({
    "app.tsx": 'import Chart from "./chart";\nexport default () => <Chart />;',
    "chart.tsx": 'export default () => <p className="text-primary">x</p>;',
  });
  expect(r.errors).toEqual([]);
  const app = atob(r.build!.imports["@art/app.tsx"].split(",")[1]);
  expect(app).toContain('"@art/chart.tsx"');
  expect(r.build!.css).toContain("text-primary");
});

test("missing relative import and entry rules", async () => {
  expect((await buildArtifact({ "app.tsx": 'import X from "./nope";\nexport default X;' })).errors[0].message).toContain("./nope");
  expect((await buildArtifact({ "x.tsx": "export default 1;" })).errors[0].message).toContain("no entry file");
  expect((await buildArtifact({ "app.tsx": "export default 1;", "index.mdx": "# x" })).errors[0].message).toContain("several entry files");
  expect((await buildArtifact({ "index.mdx": "# x", "data/a.json": "{bad" })).errors[0].path).toBe("data/a.json");
});

test("MDX supports GFM tables and frontmatter is stripped", async () => {
  const r = await compileFile("index.mdx", "---\ntitle: X\n---\n| a | b |\n|---|---|\n| 1 | 2 |\n", new Set());
  expect(r.errors).toEqual([]);
  expect(r.module!.code).toContain("table");
  expect(r.module!.code).not.toContain("title: X");
});

test("unknown kit names are rejected with suggestions", async () => {
  const tsx = await compileFile("app.tsx", 'import { Buton, Card } from "@a/ui";\nimport { useShared } from "@a/hooks";\nexport default () => <Card><Buton /></Card>;', new Set());
  expect(tsx.errors.map((e) => e.message)).toEqual(['"Buton" is not exported by @a/ui. Did you mean Button?']);
  const mdx = await compileFile("index.mdx", "# Hi\n\n<Pol id=\"x\" options={[\"a\"]} />\n\n<Poll id=\"y\" options={[\"a\"]} />\n", new Set());
  expect(mdx.errors.map((e) => e.message)).toEqual(["<Pol> is not a kit component. Did you mean Poll? See artifact_guide for the list."]);
  const local = await compileFile("index.mdx", "export const Hello = () => <b>hi</b>;\n\n<Hello />\n", new Set());
  expect(local.errors).toEqual([]);
  const icons = await compileFile("app.tsx", 'import { Check, NotAnIcon } from "lucide-react";\nexport default () => <Check />;', new Set());
  expect(icons.errors.length).toBe(1);
});

test("mermaid fences become <Diagram> and are syntax-checked at write time", async () => {
  const ok = await compileFile("index.mdx", "# Flow\n\n```mermaid\nflowchart LR\n  A[Write] --> B[Check]\n```\n", files);
  expect(ok.errors).toEqual([]);
  expect(ok.module!.code).toContain("Diagram");
  expect(ok.module!.blocks!.map((b) => b.id)).toEqual(["flow", "flow-1"]);
  const md = await compileFile("index.md", "```mermaid\nsequenceDiagram\n  A->>B: Hi\n```\n", files);
  expect(md.errors).toEqual([]);
  expect(md.module!.code).toContain("Diagram");

  const bad = await compileFile("index.mdx", "# Flow\n\n```mermaid\nflowchart LR\n  A[Write --> B\n```\n", files);
  expect(bad.errors).toHaveLength(1);
  expect(bad.errors[0].message).toStartWith("mermaid diagram (fence on line 3");
  expect(bad.errors[0].line).toBeGreaterThan(3);

  const pie = await compileFile("index.mdx", '```mermaid\npie title Share\n  "A" : 60\n  "B" : 40\n```\n', files);
  expect(pie.errors[0]?.message).toContain('<Chart type="pie">');
});

test("widths wider than a phone come back as warnings, not errors", async () => {
  const { buildArtifact, phoneWidthWarnings } = await import("../src/worker/compile.ts");
  const r = await buildArtifact({
    "index.mdx": `# Wide\n\n<div className="w-[800px] md:w-[900px] w-full min-w-120 max-w-[2000px]">x</div>\n`,
    "chart.tsx": `export default function C() { return <div style={{ width: 640, maxWidth: "100%" }} />; }`,
  });
  expect(r.errors).toEqual([]);
  expect(r.warnings?.some((w) => w.startsWith("w-[800px] is 800 px"))).toBe(true);
  expect(r.warnings?.some((w) => w.startsWith("min-w-120 is 480 px"))).toBe(true);
  expect(r.warnings?.some((w) => w.includes("md:w-[900px]"))).toBe(false);
  expect(r.warnings?.some((w) => w.startsWith("max-w"))).toBe(false);
  expect(r.warnings?.some((w) => w.startsWith("chart.tsx: width: 640"))).toBe(true);
  expect(phoneWidthWarnings(["w-80", "w-full", "sm:min-w-[50rem]"], {})).toEqual([]);
});

test("data warnings: wrong-case-free missing columns, Notion placeholders, markdown in values, unused files", async () => {
  const { dataWarnings } = await import("../src/worker/compile.ts");
  const code = { "index.mdx": `<Table data="boards.json" columns="Name Layers Price" />` };
  const data = {
    "data/boards.json": [{ name: "A", layers: 2, inStock: "__NO__", note: "**bold**" }],
    "data/unused.json": [{ x: 1 }],
  };
  const w = dataWarnings(code, data as never);
  expect(w.some((x) => x.includes("__YES__"))).toBe(true);
  expect(w.some((x) => x.includes("**markdown**"))).toBe(true);
  expect(w.some((x) => x.startsWith("data/unused.json isn't used"))).toBe(true);
  // "Name" and "Layers" match in another case; only Price is really missing.
  expect(w.find((x) => x.startsWith('Table data="boards.json"'))).toContain("(Price)");
});

test("data warnings: a Notes box whose placeholder lists fields is a log, so a Ledger is suggested", async () => {
  const { dataWarnings } = await import("../src/worker/compile.ts");
  const warn = (placeholder: string) => dataWarnings({ "index.mdx": `<Notes id="log" placeholder="${placeholder}" />` }, {});
  expect(warn("Date; recipe/version; base VG/PG; actual amounts; rest time")[0]).toContain("Ledger");
  expect(warn("Date / Project / Worked on / What improved")[0]).toContain("Ledger");
  // An ordinary prompt isn't a form.
  expect(warn("Anything we should remember about this?")).toEqual([]);
  expect(warn("Ideas, questions, links")).toEqual([]);
});

test("sources: a citation must name a source in its file, and the file must be well formed", async () => {
  const { buildArtifact } = await import("../src/worker/compile.ts");
  const page = (body: string) => ({ "index.mdx": `# T\n\n${body}\n` });
  const sources = JSON.stringify([{ id: "ftc", title: "FTC rule", url: "https://ftc.gov", checked: "2026-10-25", kind: "official" }]);
  const ok = await buildArtifact({ ...page(`Fees are capped.<Cite id="ftc" />\n\n<Sources />`), "data/sources.json": sources });
  expect(ok.errors).toEqual([]);
  // The default file counts as used.
  expect(ok.warnings ?? []).toEqual([]);
  const missing = await buildArtifact({ ...page(`Capped.<Cite id="nope" />\n\n<Sources />`), "data/sources.json": sources });
  expect(missing.errors.map((e) => e.message).join()).toContain('<Cite id="nope"> names no source');
  const bad = await buildArtifact({ ...page(`<Sources />`), "data/sources.json": JSON.stringify([{ id: "a b", url: "ftp://x", checked: "2026-02-30" }]) });
  expect(bad.errors.length).toBeGreaterThanOrEqual(3);
  const noFile = await buildArtifact(page(`<Sources />`));
  expect(noFile.errors[0]?.message).toContain("doesn't exist");
  const unlisted = await buildArtifact({ ...page(`Capped.<Cite id="ftc" />`), "data/sources.json": sources });
  expect(unlisted.errors).toEqual([]);
  expect(unlisted.warnings?.some((w) => w.includes("no <Sources"))).toBe(true);
});

test("a Decision's deciders must be literal emails, so the server can hold the page to them", async () => {
  const { buildArtifact } = await import("../src/worker/compile.ts");
  const page = (tag: string) => ({ "index.mdx": `# T\n\n${tag}\n` });
  expect((await buildArtifact(page(`<Decision id="go" question="Ship?" options={["Yes", "No"]} deciders={["sam@example.com", 'dana@example.com']} />`))).errors).toEqual([]);
  expect((await buildArtifact(page(`<Decision id="go" question="Ship?" options={["Yes", "No"]} />`))).errors).toEqual([]);
  const computed = await buildArtifact(page(`export const LIST = ["sam@example.com"]\n\n<Decision id="go" question="Ship?" options={["Yes", "No"]} deciders={LIST} />`));
  expect(computed.errors[0]?.message).toContain("literally");
});

test("recipe and evidence checks only look at the kit's own components, read whole tags, and skip computed props", async () => {
  const { buildArtifact } = await import("../src/worker/compile.ts");
  // A page with its own Sources/Cite component isn't held to the kit's data file.
  const own = await buildArtifact({ "app.tsx": `function Sources({ items }: { items: string[] }) { return <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>; }\nexport default function App() { return <Sources items={["a"]} />; }\n` });
  expect(own.errors).toEqual([]);
  // A ">" inside an earlier prop doesn't end the tag: data="x.json" is still seen.
  const arrow = await buildArtifact({
    "app.tsx": `import { Shortlist } from "@a/ui";\nexport default function App() { return <Shortlist key={[1].map((n) => n > 0).join()} data="x.json" />; }\n`,
    "data/x.json": JSON.stringify({ question: "Which?", checked: "2026-10-20", options: [
      { id: "a", name: "A", verdict: "close", summary: "First.", url: "https://a.example" },
      { id: "b", name: "B", verdict: "conditional", summary: "Second.", url: "https://b.example" },
    ] }),
  });
  expect(arrow.errors).toEqual([]);
  // A spread may carry data: not checked here.
  const spread = await buildArtifact({ "app.tsx": `import { Findings } from "@a/ui";\nconst p = { data: "f.json" };\nexport default function App() { return <Findings {...p} />; }\n` });
  expect(spread.errors.filter((e) => e.message.includes("findings.json"))).toEqual([]);
  // data-id isn't id.
  const sources = JSON.stringify([{ id: "a", title: "A", url: "https://a.example" }]);
  const hyphen = await buildArtifact({ "index.mdx": `# T\n\nX.<Cite data-note="zz" id="a" />\n\n<Sources />\n`, "data/sources.json": sources });
  expect(hyphen.errors).toEqual([]);
  // A tag mentioned in a TSX comment isn't a use.
  const comment = await buildArtifact({ "app.tsx": `// <Shortlist />\nexport default function App() { return <p>hi</p>; }\n` });
  expect(comment.errors).toEqual([]);
  // deciders with no email can't be held to anyone.
  const noEmail = await buildArtifact({ "index.mdx": `# T\n\n<Decision id="go" question="Ship?" options={["Yes", "No"]} deciders={["Sam"]} />\n` });
  expect(noEmail.errors[0]?.message).toContain("literally");
});

test("an undeclared JSX component in TSX is refused; declared forms are not", async () => {
  const bad = await compileFile("app.tsx", `import { Poll } from "@a/ui";\nexport default () => <div><Poll id="p" options={["a"]} /><Accordion>x</Accordion></div>;`, files);
  expect(bad.errors.map((e) => e.message)).toEqual([expect.stringContaining('<Accordion> is used but Accordion is never imported: add it to import { … } from "@a/ui"')]);
  const member = await compileFile("app.tsx", `export default () => <Foo.Bar />;`, files);
  expect(member.errors[0]?.message).toContain("<Foo> is used but Foo is never imported");
  const fragment = await compileFile("app.tsx", `export default () => <React.Fragment />;`, files);
  expect(fragment.errors[0]?.message).toContain("write <>…</> for a fragment");
  // A browser global is no component either.
  expect((await compileFile("app.tsx", `export default () => <Map />;`, files)).errors[0]?.message).toContain("<Map> is used but");
  const okSources = [
    `import { Accordion } from "@a/ui";\nexport default () => <Accordion />;`,
    `import { Accordion as Acc } from "@a/ui";\nexport default () => <Acc />;`,
    `import * as UI from "@a/ui";\nexport default () => <UI.Accordion />;`,
    `import Chart from "./chart";\nexport default () => <Chart />;`,
    `export default function App({ Icon }: { Icon: React.ComponentType }) { return <Icon />; }`,
    `export default ({ icon: Icon }: any) => <Icon />;`,
    `import { A, B } from "lucide-react";\nconst cond = true;\nexport default () => { const Icon = cond ? A : B; return <Icon />; };`,
    `export default () => <Row />;\nfunction Row() { return <p />; }`,
    `export default () => <Row />;\nconst Row = () => <p />;`,
    `export default () => <>{[1].map(() => <Item key="a" />)}</>;\nclass Item extends Object {}`,
    `// <Ghost /> in a comment\nexport default () => <p>{"<Ghost>"} and &lt;Ghost&gt;</p>;`,
  ];
  for (const src of okSources) {
    const r = await compileFile("app.tsx", src, files);
    expect(r.errors.filter((e) => e.message.includes("never imported"))).toEqual([]);
  }
});

test("save warnings for dated headings, hand-written freshness and wide tables", async () => {
  const { dataWarnings } = await import("../src/worker/compile.ts");
  const log = dataWarnings({ "index.mdx": "## 24 October checkpoint\n\nx\n\n## 2026-10-25\n\n## Oct 29 update\n\n## 30 Oct\n" }, {});
  expect(log.some((w) => w.includes("use <Log> over data/log.json"))).toBe(true);
  // Three, or mixed levels (an itinerary's days under a trip), aren't a log.
  expect(dataWarnings({ "index.mdx": "## 12 March: Rome\n## 13 March: Florence\n## 14 March: Siena\n" }, {})).toEqual([]);
  expect(dataWarnings({ "index.mdx": "## 24 October checkpoint\n### 2026-10-25\n## 1 Nov\n### 2 Nov\n" }, {})).toEqual([]);
  expect(dataWarnings({ "index.mdx": "<Log />\n## 1 May\n## 2 May\n## 3 May\n" }, {}).some((w) => w.includes("<Log>"))).toBe(false);
  expect(dataWarnings({ "index.mdx": "```\n## 1 May\n## 2 May\n## 3 May\n```\n" }, {})).toEqual([]);

  const fresh = (s: string) => dataWarnings({ "index.mdx": s }, {}).filter((w) => w.includes("<AsOf"));
  expect(fresh("Last checked 24 October 2026.")).toHaveLength(1);
  expect(fresh("As of 3 March the rule applies.")).toEqual([]);
  expect(fresh("Checked on 2026-10-29")).toHaveLength(1);
  expect(fresh('<AsOf checked="2026-10-29" />\nLast checked 24 October')).toEqual([]);
  expect(fresh("As of now we agree. `as of May 5`")).toEqual([]);

  const rows = Array.from({ length: 40 }, (_, i) => ({ a: i, b: "x", c: "y", d: "z" }));
  const wide = (tag: string) => dataWarnings({ "index.mdx": tag }, { "data/r.json": rows as never }).filter((w) => w.includes("cards"));
  expect(wide('<Table data="r.json" />')[0]).toContain("40 cards");
  expect(wide('<Table data="r.json" limit={10} />')).toEqual([]);
  expect(wide('<Table data="r.json" onRowClick={(r) => go(r)} limit={10} />')).toEqual([]);
  expect(wide('<Table data="r.json" cards="never" />')).toEqual([]);
  expect(wide('<Table data="r.json" columns="a b" />')).toEqual([]);
  const few = Array.from({ length: 10 }, (_, i) => ({ a: i, b: "x", c: "y", d: "z" }));
  expect(dataWarnings({ "index.mdx": '<Table data="r.json" />' }, { "data/r.json": few as never }).some((w) => w.includes("cards"))).toBe(false);
});
