# Trackers

A tracker is a page an agent keeps up over days or weeks for one goal: a
search (a family doctor taking patients, a flat), a watch on something that
changes (a wait list, a policy, a price), an errand with several parties.
Scheduled runs check, update the page and report. The reader opens it to see
where things stand in seconds, and what's waiting on them.

It has no component of its own: it is the kit's pieces in a fixed order, kept
in data files so each run changes data, not prose.

## Make one

`index.mdx`, in this order:

1. `# <the goal, in plain words>`
2. `<Summary>`: where it stands now and what, if anything, waits on the
   reader. Then `<AsOf checked="…" next="…" scope="…" />` with the last run's
   date and the next one's: it ages by itself, so never write "last checked"
   in prose.
3. **Finish line**: one or two sentences saying when this is done (and what
   rules something out, like "more than 15 minutes' walk").
4. **What waits on you**: one `Decision` per choice the next step needs
   (contact this clinic? book that slot?). Approvals given in chat go here
   too, so they're on record: say what was approved, for what, and until when.
5. **Leads**: the options or items, as a `<Table data="leads.json">` with a
   status column, best first. Give it `cardTitle` (the name column) when the
   first column is a rank or number, and `limit` past about 10 rows.
6. **Log**: `<Log data="log.json" />`, one entry per run that found
   something or did something: what changed, who was contacted and how, what
   came back. Newest first; older entries fold by themselves.
7. **How it runs**: a `<Record>` with the schedule, what it checks, who gets
   notified and when it stops. Keep any machine-only settings (automation ids,
   dedup keys) in their own data file, not on the page.
8. `<Sources />` for what the leads rest on.

## Each run

- **One save per run.** Gather everything, then write once: append the log
  entry and update leads with `artifact_patch_data`, and change `AsOf` and
  the `Summary` only when they change. Several saves a minute bury the
  page's history (only the last 50 versions are kept).
- **No entry when nothing changed**: update `AsOf` and stop.
- **Never act on approvals that aren't on the page**: an answered `Decision`
  (read it with `artifact_state`) or one the user gave you in this run.
- **Finish**: when the finish line is reached or the goal is dropped, say so
  in the Summary, add a last log entry, stop the schedule, and archive the
  page when the user is done with it.
