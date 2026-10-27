// What each page's keys do, kept in one object on the window: the list page's own script (home.js) and the
// account script (account.js, which reads the keys: src/shell/keys.ts) are separate bundles that both add to it.
// This file stays tiny so home.js doesn't carry a second copy of the key engine.
import type { Cmd, Where } from "../shared/keys.ts";

type Handler = (count: number) => boolean | void;
export type Registry = {
  where: Where;
  handlers: Map<Cmd, Handler>;
  /** Shows a short note in the corner, once src/shell/keys.ts has loaded. */
  note: (text: string) => void;
};

const KEY = Symbol.for("artifacts.keys.registry");
export const registry: Registry = ((globalThis as Record<symbol, Registry>)[KEY] ??= { where: "any", handlers: new Map(), note: () => {} });

/** What a command does on this page. */
export function onKey(cmd: Cmd, handler: Handler) {
  registry.handlers.set(cmd, handler);
}

/** Which keys this page has, for the engine and the key sheet. */
export function setKeysWhere(where: Where) {
  registry.where = where;
}

/** A short message in the corner that clears itself, also read out to screen readers. */
export function note(text: string) {
  registry.note(text);
}
