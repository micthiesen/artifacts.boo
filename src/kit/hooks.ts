// @a/hooks: React bindings over the frame store.
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { ANCHOR_TARGET_MAX, type JsonValue, type Role } from "../shared/protocol.ts";
import { commentOnTarget, TARGET_ATTR, TARGET_LABEL_ATTR } from "./annotate.ts";
import * as store from "./store.ts";

type SetStateAction<T> = T | ((prev: T) => T);
type Setter<T> = (v: SetStateAction<T> | null | undefined) => void;

function resolve<T>(action: SetStateAction<T>, prev: T): T {
  return typeof action === "function" ? (action as (p: T) => T)(prev) : action;
}

/**
 * Live shared state for everyone viewing this artifact. Updates optimistically;
 * the last write per key wins. Setting null/undefined deletes the key.
 * View-role and anonymous viewers read only; their writes no-op with a warning.
 */
export function useShared<T>(key: string, defaultValue: T): [T, Setter<T>] {
  const raw = useSyncExternalStore(store.subscribe, () => store.getShared(key));
  const value = (raw === undefined ? defaultValue : raw) as T;
  const set = useCallback<Setter<T>>(
    (action) => {
      const prevRaw = store.getShared(key);
      const prev = (prevRaw === undefined ? defaultValue : prevRaw) as T;
      const next = action === null || action === undefined ? action : resolve(action as SetStateAction<T>, prev);
      store.setShared(key, next as JsonValue | null | undefined);
    },
    // defaultValue is usually a fresh literal each render; only the key matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return [value, set];
}

export type SharedMap<T> = {
  /** [key, value] pairs (key without the prefix), sorted by key. */
  entries: [string, T][];
  get(key: string): T | undefined;
  set(key: string, value: T | ((prev: T | undefined) => T)): void;
  delete(key: string): void;
};

/**
 * A collection stored as one shared key per item: `${prefix}/${key}`.
 * Concurrent adds of different items never overwrite each other.
 */
export function useSharedMap<T>(prefix: string): SharedMap<T> {
  const entries = useSyncExternalStore(store.subscribe, () => store.getPrefixEntries(prefix)) as [string, T][];
  return useMemo<SharedMap<T>>(
    () => ({
      entries,
      get: (k) => store.getShared(`${prefix}/${k}`) as T | undefined,
      set: (k, v) => {
        const full = `${prefix}/${k}`;
        const next = typeof v === "function" ? (v as (p: T | undefined) => T)(store.getShared(full) as T | undefined) : v;
        store.setShared(full, next as JsonValue);
      },
      delete: (k) => {
        store.setShared(`${prefix}/${k}`, null);
      },
    }),
    [prefix, entries],
  );
}

/** Per-viewer storage for this artifact, kept in the viewer's browser by the shell. */
export function useLocal<T>(key: string, defaultValue: T): [T, Setter<T>] {
  const raw = useSyncExternalStore(store.subscribe, () => store.getLocal(key));
  const value = (raw === undefined ? defaultValue : raw) as T;
  const set = useCallback<Setter<T>>(
    (action) => {
      const prevRaw = store.getLocal(key);
      const prev = (prevRaw === undefined ? defaultValue : prevRaw) as T;
      const next = action === null || action === undefined ? action : resolve(action as SetStateAction<T>, prev);
      store.setLocal(key, next as JsonValue | null | undefined);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return [value, set];
}

export type ViewerInfo = { email: string | null; role: Role; canWrite: boolean };

/** The current viewer. `email` is null for anonymous viewers of public artifacts. */
export function useViewer(): ViewerInfo {
  const v = useSyncExternalStore(store.subscribe, store.getViewer);
  return useMemo(() => ({ email: v.email, role: v.role, canWrite: store.canWrite(v) }), [v]);
}

/** Emails of everyone currently viewing. */
export function usePresence(): string[] {
  return useSyncExternalStore(store.subscribe, store.getPresence);
}

/** "light" | "dark", following the viewer's shell. */
export function useTheme(): store.Theme {
  return useSyncExternalStore(store.subscribe, store.getTheme);
}

/** Contents of a data/*.json file. "repos.json" and "data/repos.json" are equivalent. Throws if missing. */
export function useData<T = JsonValue>(path: string): T {
  const boot = useSyncExternalStore(store.subscribe, store.getBoot);
  void boot;
  return store.getData(path) as T;
}

/**
 * URL of a file uploaded with artifact_asset, e.g. useAsset("assets/logo.png").
 * External URLs are blocked in artifacts, so images must be uploaded.
 */
export function useAsset(path: string): string {
  useSyncExternalStore(store.subscribe, store.getBoot);
  return store.assetUrl(path);
}

/** True when the current viewer may write shared state. */
export function canWrite(): boolean {
  return store.canWrite();
}

export function useCanWrite(): boolean {
  return useViewer().canWrite;
}

export type CommentTarget = {
  /** Spread on the item's element: these attributes are what make it a comment target. */
  props: { [TARGET_ATTR]: string; [TARGET_LABEL_ATTR]?: string };
  /** Open threads on this item. */
  count: number;
  /** False for anonymous viewers, who can read threads but not start one. */
  canComment: boolean;
  /** Opens the item's thread in the comments drawer, or starts one when it has none. */
  comment(): void;
};

/**
 * Marks an item your component renders (a task, a row, a card) as something readers can comment on.
 * `id` is yours to choose and must stay the same for the same item: threads are kept by it, so they
 * follow the item when the list is reordered or its text changes. `label` is the short name shown
 * with the thread and to agents (default: the item's text).
 */
export function useCommentTarget(id: string, label?: string): CommentTarget {
  if (id.length > ANCHOR_TARGET_MAX) store.warnOnce(`target:${id}`, `comment target id is over ${ANCHOR_TARGET_MAX} characters, so comments on it are refused: ${id.slice(0, 40)}…`);
  const info = useSyncExternalStore(store.subscribe, store.getComments);
  const count = info.counts[id] ?? 0;
  return useMemo(
    () => ({
      props: { [TARGET_ATTR]: id, ...(label ? { [TARGET_LABEL_ATTR]: label } : {}) },
      count,
      canComment: info.canComment,
      comment: () => commentOnTarget(id),
    }),
    [id, label, count, info.canComment],
  );
}
