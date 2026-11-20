import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeEach, expect, test } from "bun:test";

GlobalRegistrator.register();
afterAll(() => GlobalRegistrator.unregister());
const { anchorFromRange, installAnnotations, locate } = await import("./annotate.ts");

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = `<div id="root"><div class="art-page">
    <h2 data-b="costs">Costs</h2>
    <p data-b="costs-1">We pay $10 a month, and $10 more for support.</p>
    <table data-b="costs-2"><tbody><tr data-row="Forgejo"><td>Forgejo</td><td>$0</td></tr></tbody></table>
  </div></div>`;
  root = document.getElementById("root")!;
  installAnnotations(root, () => {});
});

function select(el: Element, text: string, nth = 0) {
  const node = el.firstChild as Text;
  let at = -1;
  for (let i = 0; i <= nth; i++) at = node.data.indexOf(text, at + 1);
  const r = document.createRange();
  r.setStart(node, at);
  r.setEnd(node, at + text.length);
  return r;
}

test("anchor from a selection carries block, quote and context", () => {
  const p = root.querySelector('[data-b="costs-1"]')!;
  const a = anchorFromRange(select(p, "$10", 1));
  expect(a).toMatchObject({ block: "costs-1", quote: { exact: "$10", prefix: "We pay $10 a month, and ", suffix: " more for support." } });
});

test("locate prefers the occurrence whose context matches", () => {
  const p = root.querySelector('[data-b="costs-1"]')!;
  const a = anchorFromRange(select(p, "$10", 1));
  const found = locate(a);
  expect(found.status).toBe("anchored");
  const before = document.createRange();
  before.setStart(p.firstChild!, 0);
  before.setEnd(found.range!.startContainer, found.range!.startOffset);
  expect(before.toString()).toBe("We pay $10 a month, and ");
});

test("changed text is outdated, a removed block is orphaned, rows anchor by key", () => {
  const p = root.querySelector('[data-b="costs-1"]')!;
  const a = anchorFromRange(select(p, "a month"));
  p.textContent = "We pay $12 per year.";
  expect(locate(a).status).toBe("outdated");
  p.remove();
  expect(locate(a).status).toBe("orphaned");
  const row = locate({ block: "costs-2", row: "Forgejo" });
  expect(row.status).toBe("anchored");
  expect(row.el?.getAttribute("data-row")).toBe("Forgejo");
});

test("whitespace differences still match", () => {
  const p = root.querySelector('[data-b="costs-1"]')!;
  p.textContent = "We pay $10   a\nmonth, and more.";
  expect(locate({ block: "costs-1", quote: { exact: "$10 a month", prefix: "", suffix: "" } }).status).toBe("anchored");
});

// ---- comment targets: items a component marked with an id of its own ----------------

function tracker(tasks: [id: string, title: string][]) {
  root.querySelector(".art-page")!.insertAdjacentHTML(
    "beforeend",
    `<ul data-b="tasks">${tasks.map(([id, title]) => `<li data-comment-target="task/${id}" data-comment-label="${title}"><span>${title}</span> <em>todo</em></li>`).join("")}</ul>`,
  );
}
const item = (id: string) => root.querySelector(`[data-comment-target="task/${id}"]`);

test("a selection inside a comment target anchors to the target, not its block", () => {
  tracker([["p1-ci", "Set up CI"], ["p2-docs", "Write docs"]]);
  const a = anchorFromRange(select(item("p1-ci")!.querySelector("span")!, "CI"));
  expect(a).toEqual({ target: "task/p1-ci", label: "Set up CI", quote: { exact: "CI", prefix: "Set up ", suffix: " todo" } });
  expect(a.block).toBeUndefined();
  expect(locate(a)).toMatchObject({ status: "anchored", el: item("p1-ci") });
  // A selection that runs out of the item is a comment on the block's text, as before.
  const r = document.createRange();
  r.setStart(item("p1-ci")!.querySelector("span")!.firstChild!, 0);
  r.setEnd(item("p2-docs")!.querySelector("span")!.firstChild!, 5);
  expect(anchorFromRange(r)).toMatchObject({ block: "tasks" });
  expect(anchorFromRange(r).target).toBeUndefined();
});

test("a thread on a target follows it through reordering and rewording, and is orphaned only when the id leaves", () => {
  tracker([["p1-ci", "Set up CI"], ["p2-docs", "Write docs"]]);
  const whole = { target: "task/p1-ci", label: "Set up CI" };
  const quoted = anchorFromRange(select(item("p1-ci")!.querySelector("span")!, "CI"));
  expect(locate(whole)).toMatchObject({ status: "anchored", el: item("p1-ci"), range: null });

  // Reordered, and moved out of the block it was in.
  const li = item("p1-ci")!;
  root.querySelector(".art-page")!.append(li);
  expect(locate(whole)).toMatchObject({ status: "anchored", el: li });
  expect(locate(quoted).status).toBe("anchored");

  // Reworded: the item's thread is untouched; a quote of the old words is outdated but still on the item.
  li.querySelector("span")!.textContent = "Continuous integration";
  li.setAttribute("data-comment-label", "Continuous integration");
  expect(locate(whole)).toMatchObject({ status: "anchored", el: li });
  expect(locate(quoted)).toMatchObject({ status: "outdated", el: li, range: null });
  // The old words turning up in another item don't move the thread there.
  item("p2-docs")!.querySelector("span")!.textContent = "Write CI docs";
  expect(locate(quoted)).toMatchObject({ status: "outdated", el: li });

  li.remove();
  expect(locate(whole)).toEqual({ status: "orphaned", range: null, el: null });
  expect(locate(quoted).status).toBe("orphaned");
  // The id coming back (a filter cleared) brings the thread back.
  tracker([["p1-ci", "CI again"]]);
  expect(locate(whole).status).toBe("anchored");
});

test("the frame reports each target's current label, counts its threads and starts or opens them", async () => {
  const { setThreads, commentOnTarget, targetAnchor } = await import("./annotate.ts");
  const store = await import("./store.ts");
  const sent: any[] = [];
  installAnnotations(root, (m) => sent.push(m));
  tracker([["p1-ci", "Set up CI"], ["p2-docs", "Write docs"]]);
  expect(targetAnchor(item("p2-docs")!)).toEqual({ target: "task/p2-docs", label: "Write docs" });
  // Without a label, an item is named by its words, not by its own controls.
  root.querySelector(".art-page")!.insertAdjacentHTML("beforeend", `<div data-comment-target="risk/1"><p data-b="risks-9">Latency  risk</p><button>Comment</button><select><option>todo</option></select></div>`);
  expect(targetAnchor(root.querySelector('[data-comment-target="risk/1"]')!)).toEqual({ target: "risk/1", label: "Latency risk" });

  commentOnTarget("task/p2-docs");
  expect(sent).toEqual([]); // not allowed to comment yet
  setThreads([], true);
  commentOnTarget("task/p2-docs");
  expect(sent.at(-1)).toEqual({ t: "comment:new", anchor: { target: "task/p2-docs", label: "Write docs" } });

  item("p1-ci")!.setAttribute("data-comment-label", "Continuous integration");
  setThreads(
    [
      { id: "t1", anchor: { target: "task/p1-ci", label: "Set up CI" } },
      { id: "t2", anchor: { target: "task/p1-ci" } },
      { id: "t3", anchor: { target: "task/gone", label: "Removed task" } },
      { id: "t4", anchor: { block: "costs-1" } },
    ],
    true,
  );
  expect(store.getComments()).toEqual({ counts: { "task/p1-ci": 2, "task/gone": 1 }, canComment: true });
  expect(sent.at(-1)).toEqual({
    t: "anchors",
    placed: [
      { id: "t4", status: "anchored" },
      { id: "t1", status: "anchored", label: "Continuous integration" },
      { id: "t2", status: "anchored", label: "Continuous integration" },
      { id: "t3", status: "orphaned" },
    ],
  });
  expect(item("p1-ci")!.classList.contains("art-commented")).toBe(true);
  commentOnTarget("task/p1-ci");
  expect(sent.at(-1)).toEqual({ t: "comment:open", thread: "t1" });
  setThreads([], false);
});

test("an item that rewrites its own class gets its comment mark back", async () => {
  const { setThreads } = await import("./annotate.ts");
  tracker([["p1-ci", "Set up CI"]]);
  setThreads([{ id: "t1", anchor: { target: "task/p1-ci" } }], true);
  const li = item("p1-ci")!;
  expect(li.className).toBe("art-commented");
  // Let the mutations from building the list go by, so only the class change is left to notice.
  await new Promise((r) => setTimeout(r, 300));
  li.className = "done"; // what React does when the component's className changes
  await new Promise((r) => setTimeout(r, 120));
  expect(li.className).toBe("done art-commented");
  setThreads([], false);
});

// ---- list items and table rows take comments of their own, with nothing marked ---------

function hover(el: Element) {
  el.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }));
  return document.querySelector<HTMLButtonElement>(".art-block-comment");
}

test("hovering a list item or table row in an unmarked component offers a comment on that item", async () => {
  const { setThreads, anchorFor } = await import("./annotate.ts");
  const sent: any[] = [];
  installAnnotations(root, (m) => sent.push(m));
  setThreads([], true);
  root.querySelector(".art-page")!.insertAdjacentHTML(
    "beforeend",
    `<div data-b="tracker"><ul>
      <li id="a"><input type="checkbox"><div><div class="title">Set up CI</div><div>Runs pgTAP</div><span>Ada</span><button>To do</button></div></li>
      <li id="b"><div><div class="title">Write <code>docs</code> first</div><button>Done</button></div></li>
      <li id="c"><button>Only a control</button></li>
    </ul></div>`,
  );
  const li = (id: string) => root.querySelector(`#${id}`)!;

  hover(li("a").querySelector("span")!)!.click();
  expect(sent.at(-1)).toMatchObject({ t: "comment:new", anchor: { block: "tracker", quote: { exact: "Set up CI" } } });
  // A title with markup in it is quoted whole.
  expect(anchorFor(li("b"))).toMatchObject({ block: "tracker", quote: { exact: "Write docs first" } });
  // The table's row, by its first cell, with the row key it already had.
  hover(root.querySelector("tr[data-row] td:last-child")!)!.click();
  expect(sent.at(-1)).toMatchObject({ anchor: { block: "costs-2", row: "Forgejo", quote: { exact: "Forgejo" } } });
  // An item with no words of its own, and anything outside an item, falls back to the block.
  hover(li("c"))!.click();
  expect(sent.at(-1).anchor).toMatchObject({ block: "tracker" });
  expect(sent.at(-1).anchor.quote).toBeUndefined();
  hover(root.querySelector('[data-b="costs-1"]')!)!.click();
  expect(sent.at(-1).anchor).toMatchObject({ block: "costs-1", label: "We pay $10 a month, and $10 more for support." });

  // The thread stays with the item when it is ticked, its status changes and the list is reordered.
  const a = anchorFor(li("a"));
  li("a").querySelector("button")!.textContent = "Done";
  li("a").querySelector("input")!.setAttribute("checked", "");
  li("a").parentElement!.prepend(li("b"));
  expect(locate(a).status).toBe("anchored");
  expect(li("a").contains(locate(a).range!.startContainer)).toBe(true);
  // Reworded, it is outdated but still on its block; a marked item (data-comment-target) would have kept it.
  li("a").querySelector(".title")!.textContent = "Continuous integration";
  expect(locate(a)).toMatchObject({ status: "outdated", el: root.querySelector('[data-b="tracker"]') });
  // An item inside a marked target is the target's.
  li("b").setAttribute("data-comment-target", "task/b");
  hover(li("b").querySelector(".title")!)!.click();
  expect(sent.at(-1).anchor).toMatchObject({ target: "task/b" });
  setThreads([], false);
});
