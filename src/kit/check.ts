// The render check publishes its result a moment after the first render (runtime.tsx). A component that only
// knows later whether it drew (a <Scene> waits for three.js and its first frame) holds the result until it has
// said so, or the check would pass a page whose scene then turns out blank.
let holds = 0;

/** Keeps the render check's result back; call the returned function once this component has reported. */
export function holdCheck(): () => void {
  holds++;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holds--;
  };
}

export const checkHeld = () => holds > 0;

// artifact_check can look at one scene as a reader sees it, at one step (?scene=2&step=3 on the check's URL):
// that scene draws full size instead of as a sheet of small views, and the page scrolls to it.

/** The scene asked for (its number on the page from 1, or its title) and the step (from 1), or null. */
export type Shot = { scene: string; step: number | null };
let shot: Shot | null | undefined;
export function checkShot(): Shot | null {
  if (shot !== undefined) return shot;
  const q = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
  const scene = q.get("scene");
  const step = Number(q.get("step"));
  shot = scene || q.has("step") ? { scene: scene || "1", step: Number.isInteger(step) && step > 0 ? step : null } : null;
  return shot;
}

/** The scene that took the shot, by its figure: the same scene mounting again claims it again. */
let found: Element | null = null;
const figures = () => [...document.querySelectorAll('[data-speak="scene"]')];

/** Whether this scene (by its figure, data-speak="scene") is the one artifact_check asked for. */
export function claimShot(figure: Element, title: string): boolean {
  const asked = checkShot();
  if (!asked) return false;
  if (found?.isConnected) return found === figure;
  const want = asked.scene.trim().toLowerCase();
  // Numbered in page order, which is the order the figures are in the document.
  if (want === String(figures().indexOf(figure) + 1) || want === title.trim().toLowerCase()) {
    found = figure;
    return true;
  }
  return false;
}

/** What to tell the agent when the scene it asked for isn't on the page. */
export function shotProblem(): string | null {
  const asked = checkShot();
  if (!asked || found?.isConnected) return null;
  const count = figures().length;
  return `artifact_check scene "${asked.scene}": no such scene on this page (it has ${count}${count ? "; pass its number from 1, in page order, or its title" : ""})`;
}
