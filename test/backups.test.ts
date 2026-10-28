// Backups expire by age as well as by count, so what someone deletes leaves backups within about a month even
// in a workspace (or the directory) that nobody changes afterwards. The newest backup always stays.
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { BACKUP_MAX_AGE_MS, newRun, pruneBackups, runTime } from "../src/worker/snapshot.ts";
import { advanceAlarm, createHub, FakeCtx, FakeR2 } from "./support/do-harness.ts";

const DAY = 86400_000;
const NOW = Date.parse("2026-10-28T12:00:00.000Z");

afterEach(() => setSystemTime());

/** A run `daysAgo` old: a page and, when complete, its manifest. */
function addRun(bucket: FakeR2, root: string, daysAgo: number, complete = true): string {
  const run = newRun(new Date(NOW - daysAgo * DAY));
  bucket.objects.set(`${root}/${run}/artifacts/0.json`, "[]");
  if (complete) bucket.objects.set(`${root}/${run}/manifest.json`, "{}");
  return run;
}
const runsIn = (bucket: FakeR2, root: string) => [...new Set([...bucket.objects.keys()].filter((k) => k.startsWith(`${root}/`)).map((k) => k.split("/")[1]))].sort();

test("run ids read back as the time they were taken", () => {
  expect(runTime(newRun(new Date(NOW)))).toBe(NOW);
  expect(runTime("nonsense")).toBeNaN();
});

test("a quiet workspace's old backups go, except the newest", async () => {
  const bucket = new FakeR2();
  for (const d of [90, 60, 50, 40]) addRun(bucket, "acme", d);
  const newest = addRun(bucket, "acme", 36);
  const next = await pruneBackups(bucket as never, "acme", 30, [], NOW);
  expect(runsIn(bucket, "acme")).toEqual([newest]);
  expect(next).toBeNull();
});

test("an active workspace keeps its count and age limits, and says when the oldest expires", async () => {
  const bucket = new FakeR2();
  const runs = Array.from({ length: 40 }, (_, i) => addRun(bucket, "acme", i));
  // Count limit: 30 newest, all under 35 days.
  const next = await pruneBackups(bucket as never, "acme", 30, [], NOW);
  expect(runsIn(bucket, "acme")).toEqual(runs.slice(0, 30).sort());
  expect(next).toBe(NOW - 29 * DAY + BACKUP_MAX_AGE_MS);
  // Free: 7, whatever their age.
  expect(await pruneBackups(bucket as never, "acme", 7, [], NOW)).toBe(NOW - 6 * DAY + BACKUP_MAX_AGE_MS);
  expect(runsIn(bucket, "acme")).toHaveLength(7);
});

test("a run a queued restore needs stays, and incomplete runs go after a day", async () => {
  const bucket = new FakeR2();
  const pinned = addRun(bucket, "acme", 80);
  addRun(bucket, "acme", 3, false);
  const fresh = addRun(bucket, "acme", 0.5, false);
  const newest = addRun(bucket, "acme", 0);
  await pruneBackups(bucket as never, "acme", 30, [pinned], NOW);
  expect(runsIn(bucket, "acme")).toEqual([pinned, fresh, newest].sort());
});

test("a workspace comes back for its expiring backups with no further changes", async () => {
  setSystemTime(new Date(NOW));
  const bucket = new FakeR2();
  const h = await createHub({ BACKUPS: bucket });
  const old = addRun(bucket, "acme", 20);
  await h.hub.backup();
  for (let i = 0; i < 20 && (await advanceAlarm(h)); i++) {
    if (!h.ctx.sqlStorage.exec(`SELECT 1 FROM settings WHERE key IN ('job', 'jobs_next')`).toArray().length) break;
  }
  const [newest] = await h.hub.backups();
  expect(runsIn(bucket, "acme")).toEqual([old, newest].sort());
  const pruneAt = Number(h.ctx.sqlStorage.exec(`SELECT value FROM settings WHERE key = 'backup_prune_at'`).one().value);
  expect(pruneAt).toBe(runTime(old) + BACKUP_MAX_AGE_MS);
  expect(h.ctx.alarm).not.toBeNull();
  expect(h.ctx.alarm!).toBeLessThanOrEqual(pruneAt);

  // Nothing changes for a month and more: the alarm still comes, and the old run goes.
  setSystemTime(new Date(pruneAt + 1000));
  h.ctx.alarm = pruneAt;
  await advanceAlarm(h);
  expect(runsIn(bucket, "acme")).toEqual([newest]);
  expect(h.ctx.sqlStorage.exec(`SELECT 1 FROM settings WHERE key = 'backup_prune_at'`).toArray()).toEqual([]);
});

test("the directory's backups expire the same way", async () => {
  setSystemTime(new Date(NOW));
  const bucket = new FakeR2();
  const { Directory } = await import("../src/worker/directory.ts");
  const ctx = new FakeCtx();
  const dir = new Directory(ctx as never, { LOGIN_SECRET: "x", BACKUPS: bucket } as never);
  addRun(bucket, "_directory", 60);
  const old = addRun(bucket, "_directory", 20);
  dir.setName("dana@corp.com", "Dana");
  const prefix = await dir.backup();
  const newest = prefix!.split("/")[1]!;
  expect(runsIn(bucket, "_directory")).toEqual([old, newest].sort());
  const pruneAt = runTime(old) + BACKUP_MAX_AGE_MS;
  expect(Number(ctx.sqlStorage.exec(`SELECT value FROM settings WHERE key = 'backup_prune_at'`).one().value)).toBe(pruneAt);
  // Tonight's backup alarm was already set and comes first; when it fires it re-arms for the expiry.
  expect(ctx.alarm!).toBeLessThanOrEqual(pruneAt);
  ctx.alarm = null;
  await dir.alarm();
  expect(ctx.alarm).toBe(pruneAt);

  setSystemTime(new Date(pruneAt + 1000));
  ctx.alarm = null;
  await dir.alarm();
  expect(runsIn(bucket, "_directory")).toEqual([newest]);
});
