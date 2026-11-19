import { Badge, Button, Select } from "@a/ui";
import { useCommentTarget, useData, useLocal, useShared } from "@a/hooks";

type Task = { id: string; title: string; owner: string };
const STATUSES = ["todo", "doing", "done"];

function Row({ task }: { task: Task }) {
  const [status, setStatus] = useShared(`status/${task.id}`, "todo");
  // The id comes from the data, so a thread stays with its task when the list is sorted or the title changes.
  const c = useCommentTarget(`task/${task.id}`, task.title);
  return (
    <li {...c.props} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border py-2.5 last:border-b-0">
      <span className="min-w-0 flex-1 basis-48">{task.title}</span>
      <Badge tone="neutral">{task.owner}</Badge>
      <div className="w-36 shrink-0">
        <Select options={STATUSES} value={status} onValueChange={(v: string) => setStatus(v)} aria-label={`Status of ${task.title}`} />
      </div>
      {(c.count > 0 || c.canComment) && (
        <Button variant="ghost" size="sm" onClick={c.comment}>
          {c.count ? `${c.count} ${c.count === 1 ? "comment" : "comments"}` : "Comment"}
        </Button>
      )}
    </li>
  );
}

export function Tracker() {
  const tasks = useData<Task[]>("tasks.json");
  const [byOwner, setByOwner] = useLocal("byOwner", false);
  const shown = byOwner ? [...tasks].sort((a, b) => a.owner.localeCompare(b.owner) || a.title.localeCompare(b.title)) : tasks;
  return (
    <div>
      <Button variant="outline" size="sm" onClick={() => setByOwner(!byOwner)}>
        {byOwner ? "Sort by priority" : "Sort by owner"}
      </Button>
      <ul className="mt-3">
        {shown.map((t) => (
          <Row key={t.id} task={t} />
        ))}
      </ul>
    </div>
  );
}
