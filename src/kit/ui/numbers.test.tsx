// Numbers that changed: units read the way people say them, the change is worked out right, and better or
// worse follows which way is good.
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
const { BulletBarImpl, DeltaImpl, computeDelta, formatPercent, formatQuantity, niceCeil, scaleUnit, targetVerdict } = await import("./numbers-impl.tsx");
const { Stat } = await import("./layout.tsx");

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 20));
  await GlobalRegistrator.unregister();
});

describe("units", () => {
  test("scale to the unit a person would use", () => {
    expect(scaleUnit(1500, "ms")).toEqual([1.5, "s"]);
    expect(scaleUnit(999, "ms")).toEqual([999, "ms"]);
    expect(scaleUnit(0.4, "s")).toEqual([400, "ms"]);
    expect(scaleUnit(150, "s")).toEqual([2.5, "min"]);
    expect(scaleUnit(180_000, "ms")).toEqual([3, "min"]);
    expect(scaleUnit(1200, "MB")).toEqual([1.2, "GB"]);
    expect(scaleUnit(-2000, "ms")).toEqual([-2, "s"]);
    expect(scaleUnit(5000, "req/s")).toEqual([5000, "req/s"]);
  });

  test("format with sensible decimals, signs and unit placement", () => {
    expect(formatQuantity(2100, "ms")).toBe("2.1 s");
    expect(formatQuantity(1234, "ms")).toBe("1.23 s");
    expect(formatQuantity(850, "ms")).toBe("850 ms");
    expect(formatQuantity(-1200, "ms", true)).toBe("−1.2 s");
    expect(formatQuantity(12.345, "%")).toBe("12.3%");
    expect(formatQuantity(1200, "$")).toBe("$1,200");
    expect(formatQuantity(4.5, "$")).toBe("$4.50");
    expect(formatQuantity(-300, "$", true)).toBe("−$300");
    expect(formatQuantity(12345)).toBe("12,345");
    expect(formatQuantity(0.0042)).toBe("0.0042");
    expect(formatQuantity(3, "x")).toBe("3x");
    expect(formatQuantity(0.001, "", true)).toBe("+0.001");
    // A value that rounds away carries no sign.
    expect(formatQuantity(0.004, "$", true)).toBe("$0.00");
  });

  test("percent change: whole numbers from 10, one decimal below", () => {
    expect(formatPercent(-38.2)).toBe("−38%");
    expect(formatPercent(4.56)).toBe("+4.6%");
    expect(formatPercent(0.01)).toBe("0%");
  });
});

describe("delta", () => {
  test("an improvement reads better whichever way is good", () => {
    const faster = computeDelta({ before: 3200, after: 2000, unit: "ms", better: "down" });
    expect(faster).toMatchObject({ direction: "down", verdict: "better", change: "−1.2 s · −38%" });
    const slower = computeDelta({ before: 2000, after: 3200, unit: "ms", better: "down" });
    expect(slower).toMatchObject({ direction: "up", verdict: "worse", change: "+1.2 s · +60%" });
    const more = computeDelta({ before: 40, after: 52, better: "up" });
    expect(more).toMatchObject({ verdict: "better", change: "+12 · +30%" });
  });

  test("no change is flat, even through floating point", () => {
    expect(computeDelta({ before: 0.1 + 0.2, after: 0.3, better: "up" })).toMatchObject({ direction: "flat", verdict: "same", change: "No change" });
  });

  test("percentages change in points; from zero there is no percent", () => {
    expect(computeDelta({ before: 4, after: 2, unit: "%", better: "down" }).change).toBe("−2 pp · −50%");
    expect(computeDelta({ before: 0, after: 5, unit: "MB", better: "down" })).toMatchObject({ pct: null, change: "+5 MB", verdict: "worse" });
    // Relative change is against the size of before, so a negative start still reads the right way.
    expect(computeDelta({ before: -10, after: -5, better: "up" })).toMatchObject({ pct: 50, verdict: "better" });
  });

  test("renders each row with After and the change, and flags a bad row in place", async () => {
    const html = await markup(
      <DeltaImpl
        title="Page load"
        chart
        rows={[
          { label: "p95 load", before: 3200, after: 2000, unit: "ms", better: "down", note: "cold cache" },
          { label: "Bundle", before: 410, after: 410, unit: "KB", better: "down" },
          { label: "Broken", before: 1 } as never,
        ]}
      />,
    );
    expect(html).toContain("3.2 s");
    expect(html).toContain("2 s");
    expect(html).toContain("−1.2 s · −38%");
    expect(html).toContain("· better");
    expect(html).toContain("No change");
    expect(html).toContain("cold cache");
    expect(html).toContain('Can\'t show this row: "Broken": "after" is a number');
    expect(html.match(/<circle/g)?.length).toBe(4);
  });
});

describe("bullet bar", () => {
  test("verdict follows which way is good", () => {
    expect(targetVerdict(180, 200, "down")).toBe("on target");
    expect(targetVerdict(220, 200, "down")).toBe("over target");
    expect(targetVerdict(80, 100)).toBe("below target");
    expect(niceCeil(231)).toBe(250);
    expect(niceCeil(0.7)).toBe(1);
    expect(niceCeil(100)).toBe(100);
  });

  test("says value of target in words and in its label", async () => {
    const html = await markup(<BulletBarImpl label="p95 latency" value={180} target={200} bands={[150, 250]} unit="ms" better="down" />);
    expect(html).toContain('aria-label="p95 latency: 180 ms of 200 ms target"');
    expect(html).toContain("of 200 ms target");
    expect(html).toContain("on target");
  });
});

test("Stat draws its trend, coloured by the delta's tone", async () => {
  const up = await markup(<Stat label="Users" value="1,204" delta="+12%" trend={[3, 5, 4, 8]} />);
  expect(up).toContain("<polyline");
  expect(up).toContain("var(--positive)");
  const costDown = await markup(<Stat label="Cost" value="$420" invert trend={[9, 7, 5]} />);
  expect(costDown).toContain("var(--positive)");
  expect(await markup(<Stat label="Cost" value="$420" />)).not.toContain("<svg");
});
