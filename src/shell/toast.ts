// A short message at the bottom of the page, with an optional action (Undo). It times out after six
// seconds; a new toast replaces the one showing.
import { motionMs } from "../shared/motion.ts";

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string, action?: { label: string; run: () => void }) {
  document.querySelector(".toast")?.remove();
  clearTimeout(toastTimer);
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  const text = document.createElement("span");
  text.textContent = message;
  el.append(text);
  if (action) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = action.label;
    b.addEventListener("click", () => {
      el.remove();
      action.run();
    });
    el.append(b);
  }
  document.body.append(el);
  // Timing out, it drops away (.toast.leaving); a new toast replacing it just takes its place.
  toastTimer = setTimeout(() => {
    el.classList.add("leaving");
    toastTimer = setTimeout(() => el.remove(), motionMs("fast"));
  }, 6000);
}
