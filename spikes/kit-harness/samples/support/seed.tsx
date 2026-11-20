// What the service writes to a request's page (the harness has no service): a released fix waiting for the
// reporter's answer, with a plan and a log. Viewer A is the reporter.
import * as React from "react";
import { useShared } from "@a/hooks";

const LOG = [
  { at: "2026-11-18T17:20:00.000Z", actor: "agent", event: "Status: investigating", status: "investigating" },
  { at: "2026-11-18T17:42:00.000Z", actor: "agent", event: "Plan set" },
  { at: "2026-11-18T18:10:00.000Z", actor: "agent", event: "Read the linked page acme/a/aqr5hcvz6admw" },
  { at: "2026-11-19T09:30:00.000Z", actor: "agent", event: "Status: fix_deployed", status: "fix_deployed" },
];

export function Seed() {
  const [status, setStatus] = useShared<unknown>("case/status", null);
  const [, setPlan] = useShared<unknown>("case/plan", null);
  const [, setLog] = useShared<unknown>("case/log", null);
  React.useEffect(() => {
    if (status) return;
    setStatus({
      status: "fix_deployed",
      at: "2026-11-19T09:30:00.000Z",
      thread: null,
      history: [{ status: "new", at: "2026-11-18T17:05:00.000Z" }],
      fix: { summary: "Tables show as cards on phones.", version: "c5a3fbaf01c5" },
    });
    setPlan({ text: "1. Reproduce at 390 px in Safari.\n2. Render wide tables as cards under 480 px.\n3. Add a phone case to the layout check.", at: "2026-11-18T17:42:00.000Z" });
    setLog(LOG);
  }, [status]);
  return null;
}
