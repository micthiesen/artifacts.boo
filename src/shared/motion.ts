// Feedback motion for the shell and the kit. The durations and curves live in CSS
// (--motion-* in src/kit/theme.css, mirrored in src/shell/shell.css); the
// keyframes are the art-move-* classes beside them. See AGENTS.md for the rules.
import { playSound, soundLatency, willPlay, type SoundName } from "./sound.ts";

/** pop: something you did just landed. glow: someone else changed this. */
export type Motion = "pop" | "glow";

/** Each sound's motion: a sound never plays without one. */
const SOUND_MOTION: Record<SoundName, Motion> = { send: "pop", approve: "pop", arrive: "glow", toggle: "pop" };

const cleaning = new WeakSet<HTMLElement>();

/** Takes a finished motion's class and delay off again, with one listener per element however often it moves. */
function cleanUpAfter(el: HTMLElement) {
  if (cleaning.has(el)) return;
  cleaning.add(el);
  el.addEventListener("animationend", (e) => {
    if (e.target !== el || !e.animationName.startsWith("art-move-")) return;
    // Restarting cancels the running animation (animationcancel, ignored here), so only a real end gets here.
    el.classList.remove(e.animationName);
    el.style.removeProperty("--move-delay");
  });
}

/**
 * Runs a feedback motion on an element: restarts its art-move-<motion> class. `delayMs` holds it back so it
 * lands with a sound that is heard late.
 */
export function move(el: Element | null | undefined, motion: Motion, delayMs = 0): boolean {
  // Only what is on screen: a hidden element (a closed drawer, another tab panel) would keep the class and play
  // the motion late, whenever it is next shown.
  if (!shown(el)) return false;
  const cls = `art-move-${motion}`;
  cleanUpAfter(el);
  // One motion at a time: the later one would win the animation and leave the other's class behind.
  el.classList.remove("art-move-pop", "art-move-glow");
  // Reading layout restarts an animation that is already running on this element.
  void el.offsetWidth;
  if (delayMs > 0) el.style.setProperty("--move-delay", `${Math.round(delayMs)}ms`);
  else el.style.removeProperty("--move-delay");
  el.classList.add(cls);
  return true;
}

/** Whether an element is on the page and laid out (not inside something hidden). */
export function shown(el: Element | null | undefined): el is HTMLElement {
  return el instanceof HTMLElement && el.isConnected && el.getClientRects().length > 0;
}

/**
 * The only way to play a UI sound: the sound and its motion start in the same frame. When the output is slow
 * to sound (Bluetooth), the motion waits by the same amount so the two still land together. Nothing plays when
 * the element isn't on the page.
 */
export function cue(el: Element | null | undefined, sound: SoundName) {
  // A background tab shows nothing, so it plays nothing either.
  if (typeof document !== "undefined" && document.hidden) return;
  // Hold the motion back only for a sound that is about to play.
  const latency = willPlay(sound) ? soundLatency() : 0;
  if (!move(el, SOUND_MOTION[sound], latency > 0.04 ? latency * 1000 : 0)) return;
  playSound(sound);
}

/** A motion duration token in milliseconds, for code that has to wait for a CSS transition. */
export function motionMs(token: "fast" | "base" | "slow"): number {
  if (typeof getComputedStyle === "undefined") return 0;
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--motion-${token}`).trim();
  return raw.endsWith("ms") ? parseFloat(raw) : raw.endsWith("s") ? parseFloat(raw) * 1000 : 0;
}

/**
 * The --motion-ease curve as a function of progress (0 to 1), for the few motions CSS can't run (a camera
 * turning inside a canvas). Reads the token, so there is still one curve.
 */
export function motionEase(): (t: number) => number {
  const raw = typeof getComputedStyle === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue("--motion-ease");
  const p = /cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/.exec(raw)?.slice(1).map(Number) ?? [0.2, 0.8, 0.2, 1];
  const [x1, y1, x2, y2] = p as [number, number, number, number];
  const at = (a: number, b: number, s: number) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
  return (t) => {
    if (t <= 0 || t >= 1) return Math.min(1, Math.max(0, t));
    // The curve gives x and y for a parameter s; find the s whose x is t.
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < t) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}
