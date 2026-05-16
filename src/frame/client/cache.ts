import type { Ref, Records } from "../core/normalize";

/** A root entry in the cache. For query operations, this is a per-alias map:
 *  `{posts: refs, currentUser: ref}`. */
export type RootValue = Record<string, Ref | readonly Ref[] | null>;

type Listener = () => void;

interface RootMeta {
  readonly fetchedAt: number;
  readonly staleTime: number;
}

export class FrameCache {
  records: Records = {};
  private roots = new Map<string, RootValue>();
  private rootMeta = new Map<string, RootMeta>();
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }

  setRoot(key: string, value: RootValue): void {
    this.roots.set(key, value);
  }

  getRoot(key: string): RootValue | undefined {
    return this.roots.get(key);
  }

  hasRoot(key: string): boolean {
    return this.roots.has(key);
  }

  /** True iff the root exists AND its TTL has not elapsed.
   *  Roots with `staleTime: Infinity` are never stale. */
  isStale(key: string, now: number = Date.now()): boolean {
    const meta = this.rootMeta.get(key);
    if (!meta) return true;
    if (meta.staleTime === Infinity) return false;
    return now - meta.fetchedAt >= meta.staleTime;
  }

  /** Force a root to be considered stale on next read. */
  invalidateRoot(key: string): void {
    if (this.rootMeta.has(key)) {
      this.rootMeta.set(key, { fetchedAt: 0, staleTime: 0 });
      this.notify();
    }
  }

  /** Invalidate every root whose key matches the predicate. */
  invalidateRoots(predicate: (key: string) => boolean): void {
    let touched = false;
    for (const key of this.roots.keys()) {
      if (predicate(key)) {
        this.rootMeta.set(key, { fetchedAt: 0, staleTime: 0 });
        touched = true;
      }
    }
    if (touched) this.notify();
  }

  /** Invalidate every cached root. */
  invalidateAll(): void {
    for (const key of this.roots.keys()) {
      this.rootMeta.set(key, { fetchedAt: 0, staleTime: 0 });
    }
    this.notify();
  }

  ingest(records: Records, root: { key: string; value: RootValue; staleTime?: number }): void {
    for (const [k, fields] of Object.entries(records)) {
      const existing = this.records[k] ?? {};
      this.records[k] = { ...existing, ...fields };
    }
    this.roots.set(root.key, root.value);
    this.rootMeta.set(root.key, {
      fetchedAt: Date.now(),
      staleTime: root.staleTime ?? 0,
    });
    this.notify();
  }

  /** Merge records without setting any root — used by mutations whose result
   *  is a single entity (not bound to a named query slot). */
  ingestRecords(records: Records): void {
    for (const [k, fields] of Object.entries(records)) {
      const existing = this.records[k] ?? {};
      this.records[k] = { ...existing, ...fields };
    }
    this.notify();
  }

  appendConnection(
    recordKey: string,
    slot: string,
    moreRecords: Records,
    moreEdges: readonly Ref[],
    pageInfo: {
      hasNextPage: boolean;
      hasPreviousPage: boolean;
      startCursor: string | null;
      endCursor: string | null;
    },
  ): void {
    for (const [k, fields] of Object.entries(moreRecords)) {
      const existing = this.records[k] ?? {};
      this.records[k] = { ...existing, ...fields };
    }
    const rec = this.records[recordKey];
    if (!rec) return;
    const existing = rec[slot] as
      | { edges: readonly Ref[]; pageInfo: typeof pageInfo; __connection: true }
      | undefined;
    if (existing && existing.__connection) {
      rec[slot] = {
        __connection: true,
        edges: [...existing.edges, ...moreEdges],
        pageInfo,
      };
    } else {
      rec[slot] = {
        __connection: true,
        edges: [...moreEdges],
        pageInfo,
      };
    }
    this.notify();
  }

  getRecord(key: string): Record<string, unknown> | undefined {
    return this.records[key];
  }

  clearRoot(key: string): void {
    this.roots.delete(key);
    this.notify();
  }

  /** Insert a ref into a connection's edges array. */
  insertConnection(parentKey: string, slot: string, ref: Ref, where: "prepend" | "append"): void {
    const rec = this.records[parentKey];
    if (!rec) return;
    const existing = rec[slot] as
      | {
          __connection: true;
          edges: readonly Ref[];
          pageInfo: {
            hasNextPage: boolean;
            hasPreviousPage: boolean;
            startCursor: string | null;
            endCursor: string | null;
          };
        }
      | undefined;
    const edges = existing?.edges ?? [];
    rec[slot] = {
      __connection: true,
      edges: where === "prepend" ? [ref, ...edges] : [...edges, ref],
      pageInfo: existing?.pageInfo ?? {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: null,
        endCursor: null,
      },
    };
    this.notify();
  }

  /** Remove a ref from a connection's edges (by ref id). */
  removeFromConnection(parentKey: string, slot: string, refId: string): void {
    const rec = this.records[parentKey];
    if (!rec) return;
    const existing = rec[slot] as
      | {
          __connection: true;
          edges: readonly Ref[];
          pageInfo: {
            hasNextPage: boolean;
            hasPreviousPage: boolean;
            startCursor: string | null;
            endCursor: string | null;
          };
        }
      | undefined;
    if (!existing) return;
    rec[slot] = {
      __connection: true,
      edges: existing.edges.filter((e) => e.__ref !== refId),
      pageInfo: existing.pageInfo,
    };
    this.notify();
  }

  /** Replace one edge ref with another (preserves position). */
  replaceInConnection(parentKey: string, slot: string, oldRefId: string, newRef: Ref): void {
    const rec = this.records[parentKey];
    if (!rec) return;
    const existing = rec[slot] as
      | {
          __connection: true;
          edges: readonly Ref[];
          pageInfo: {
            hasNextPage: boolean;
            hasPreviousPage: boolean;
            startCursor: string | null;
            endCursor: string | null;
          };
        }
      | undefined;
    if (!existing) return;
    rec[slot] = {
      __connection: true,
      edges: existing.edges.map((e) => (e.__ref === oldRefId ? newRef : e)),
      pageInfo: existing.pageInfo,
    };
    this.notify();
  }

  /** Delete a record from the cache. Does not touch connections that
   *  reference it; pair with `removeFromConnection` for full cleanup. */
  deleteRecord(key: string): void {
    if (key in this.records) {
      delete this.records[key];
      this.notify();
    }
  }
}

export const makeCache = () => new FrameCache();
