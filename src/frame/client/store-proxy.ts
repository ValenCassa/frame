import type { FieldDef, FrameType } from "../core/type";
import type { Ref } from "../core/normalize";
import { stableStringify, storageKey } from "../core/wire";
import type { FrameCache } from "./cache";

// ─────────────────────────────────────────────────────────────────────────────
// Type-level field metadata extraction.

type AnyType = FrameType<string, Record<string, FieldDef>>;

/** Picks fields of a type whose `kind` is in the union `K`. */
type FieldsOfKind<T extends AnyType, K extends FieldDef["kind"]> = {
  [F in keyof T["fields"]]: T["fields"][F]["kind"] extends K ? F : never;
}[keyof T["fields"]] &
  string;

type ScalarFields<T extends AnyType> = FieldsOfKind<T, "scalar">;
type RefFields<T extends AnyType> = FieldsOfKind<T, "ref">;
type ListFields<T extends AnyType> = FieldsOfKind<T, "list">;

/** Resolved scalar TS type for field `K` on type `T`. */
type ScalarType<T extends AnyType, K extends keyof T["fields"]> = T["fields"][K] extends {
  schema: { Type: infer A };
}
  ? A
  : unknown;

/** Args type declared on a field (or `undefined` if none). */
type FieldArgs<T extends AnyType, K extends keyof T["fields"]> = T["fields"][K] extends {
  args: { Type: infer A };
}
  ? A
  : undefined;

/** Target FrameType for a ref/list field. */
type TargetType<T extends AnyType, K extends keyof T["fields"]> = T["fields"][K] extends {
  target: () => infer R;
}
  ? R extends AnyType
    ? R
    : never
  : never;

// ─────────────────────────────────────────────────────────────────────────────

const toRefId = (r: string | RecordProxy<any>): string => (typeof r === "string" ? r : r.ref);

const isRefValue = (v: unknown): v is Ref =>
  typeof v === "object" && v !== null && "__ref" in (v as { __ref?: unknown });

const slotOf = (field: string, args: unknown): string =>
  args === undefined ? field : storageKey(field, args);

/** Split a storage-key slot into its field name + parsed args.
 *  Returns `args: undefined` when the slot has no `(...)` suffix. */
const parseSlot = (slot: string): { field: string; args: unknown } => {
  const parenIx = slot.indexOf("(");
  if (parenIx === -1) return { field: slot, args: undefined };
  if (!slot.endsWith(")")) return { field: slot, args: undefined };
  const field = slot.slice(0, parenIx);
  const argsJson = slot.slice(parenIx + 1, -1);
  try {
    return { field, args: JSON.parse(argsJson) };
  } catch {
    return { field, args: undefined };
  }
};

const isConnectionValue = (v: unknown): v is { __connection: true; edges: readonly Ref[] } =>
  typeof v === "object" && v !== null && (v as { __connection?: unknown }).__connection === true;

// ─────────────────────────────────────────────────────────────────────────────
// RecordProxy<T>

/** A typed proxy over a normalized cache record.
 *  When `T = unknown`, methods accept any field name (untyped fallback). */
export class RecordProxy<T extends AnyType = AnyType> {
  constructor(
    readonly cache: FrameCache,
    readonly ref: string,
  ) {}

  getDataID(): string {
    return this.ref;
  }

  getType(): string {
    return (this.cache.records[this.ref]?.["__typename"] as string) ?? "";
  }

  /** Read a scalar field. Field name + return type are type-checked. */
  getValue<K extends ScalarFields<T>>(
    field: K,
    args?: FieldArgs<T, K>,
  ): ScalarType<T, K> | undefined {
    const rec = this.cache.records[this.ref];
    if (!rec) return undefined;
    return rec[slotOf(field, args)] as ScalarType<T, K> | undefined;
  }

  /** Set a scalar field. Field name + value type are type-checked. */
  setValue<K extends ScalarFields<T>>(
    field: K,
    value: ScalarType<T, K>,
    args?: FieldArgs<T, K>,
  ): this {
    const rec = this.cache.records[this.ref];
    if (!rec) return this;
    rec[slotOf(field, args)] = value;
    this.cache.ingestRecords({});
    return this;
  }

  /** Read a linked record (singular). Returns null if unset. */
  getLink<K extends RefFields<T>>(
    field: K,
    args?: FieldArgs<T, K>,
  ): RecordProxy<TargetType<T, K>> | null {
    const v = this.cache.records[this.ref]?.[slotOf(field, args)];
    if (!isRefValue(v)) return null;
    return new RecordProxy<TargetType<T, K>>(this.cache, v.__ref);
  }

  /** Read every item from a plain list field. */
  getListItems<K extends ListFields<T>>(
    field: K,
    args?: FieldArgs<T, K>,
  ): RecordProxy<TargetType<T, K>>[] {
    const v = this.cache.records[this.ref]?.[slotOf(field, args)];
    if (!Array.isArray(v)) return [];
    return v.filter(isRefValue).map((r) => new RecordProxy<TargetType<T, K>>(this.cache, r.__ref));
  }

  /** Read a single item by index from a plain list field. */
  getListItem<K extends ListFields<T>>(
    field: K,
    index: number,
    args?: FieldArgs<T, K>,
  ): RecordProxy<TargetType<T, K>> | null {
    const v = this.cache.records[this.ref]?.[slotOf(field, args)];
    if (!Array.isArray(v)) return null;
    const r = v[index];
    if (!isRefValue(r)) return null;
    return new RecordProxy<TargetType<T, K>>(this.cache, r.__ref);
  }

  /** Set a linked record. The target type is enforced by the field's target. */
  setLink<K extends RefFields<T>>(
    field: K,
    ref: RecordProxy<TargetType<T, K>> | string | null,
    args?: FieldArgs<T, K>,
  ): this {
    const rec = this.cache.records[this.ref];
    if (!rec) return this;
    rec[slotOf(field, args)] = ref == null ? null : { __ref: toRefId(ref) };
    this.cache.ingestRecords({});
    return this;
  }

  /** Replace every item in a plain list field. */
  setListItems<K extends ListFields<T>>(
    field: K,
    items: ReadonlyArray<RecordProxy<TargetType<T, K>> | string>,
    args?: FieldArgs<T, K>,
  ): this {
    const rec = this.cache.records[this.ref];
    if (!rec) return this;
    rec[slotOf(field, args)] = items.map((r) => ({ __ref: toRefId(r) }));
    this.cache.ingestRecords({});
    return this;
  }

  /** Set the item at a specific index in a plain list field. No-op when
   *  the index is out of bounds. */
  setListItem<K extends ListFields<T>>(
    field: K,
    index: number,
    item: RecordProxy<TargetType<T, K>> | string,
    args?: FieldArgs<T, K>,
  ): this {
    const rec = this.cache.records[this.ref];
    if (!rec) return this;
    const slot = slotOf(field, args);
    const existing = (Array.isArray(rec[slot]) ? rec[slot] : []) as readonly Ref[];
    if (index < 0 || index >= existing.length) return this;
    rec[slot] = existing.map((r, i) => (i === index ? { __ref: toRefId(item) } : r));
    this.cache.ingestRecords({});
    return this;
  }

  /** Open a connection proxy for a paginated list field. */
  getConnection<K extends ListFields<T>>(
    field: K,
    args?: FieldArgs<T, K>,
  ): ConnectionProxy<TargetType<T, K>> | null {
    const slot = slotOf(field, args);
    const rec = this.cache.records[this.ref];
    if (!rec) return null;
    const v = rec[slot];
    if (!isConnectionValue(v)) return null;
    return new ConnectionProxy<TargetType<T, K>>(this.cache, this.ref, slot);
  }

  /** Every connection on this record for the given field, across all argument
   *  variants the cache has seen. */
  connections<K extends ListFields<T>>(field: K): ConnectionProxy<TargetType<T, K>>[] {
    const rec = this.cache.records[this.ref];
    if (!rec) return [];
    const out: ConnectionProxy<TargetType<T, K>>[] = [];
    for (const slot of Object.keys(rec)) {
      const parsed = parseSlot(slot);
      if (parsed.field !== field) continue;
      if (!isConnectionValue(rec[slot])) continue;
      out.push(new ConnectionProxy<TargetType<T, K>>(this.cache, this.ref, slot));
    }
    return out;
  }

  delete(): void {
    this.cache.deleteRecord(this.ref);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ConnectionProxy<T>

export class ConnectionProxy<T extends AnyType = AnyType> {
  constructor(
    readonly cache: FrameCache,
    readonly parentRef: string,
    readonly slot: string,
  ) {}

  /** Field name this connection was declared on (e.g. `"tasks"`). */
  get field(): string {
    return parseSlot(this.slot).field;
  }

  /** Args used to fetch this connection. Useful for filtering when walking
   *  multiple connection variants (`record.connections(field)`). */
  get args(): unknown {
    return parseSlot(this.slot).args;
  }

  /** Parent record proxy. */
  get parent(): RecordProxy<AnyType> {
    return new RecordProxy(this.cache, this.parentRef);
  }

  prependNode(node: RecordProxy<T> | string): void {
    this.cache.insertConnection(this.parentRef, this.slot, { __ref: toRefId(node) }, "prepend");
  }

  appendNode(node: RecordProxy<T> | string): void {
    this.cache.insertConnection(this.parentRef, this.slot, { __ref: toRefId(node) }, "append");
  }

  removeNode(nodeId: string): void {
    this.cache.removeFromConnection(this.parentRef, this.slot, nodeId);
  }

  nodes(): RecordProxy<T>[] {
    const v = this.cache.records[this.parentRef]?.[this.slot] as
      | { edges?: readonly Ref[] }
      | undefined;
    if (!v?.edges) return [];
    return v.edges.map((e) => new RecordProxy<T>(this.cache, e.__ref));
  }

  /** True if any edge points to the given node id. */
  contains(nodeId: string): boolean {
    const v = this.cache.records[this.parentRef]?.[this.slot] as
      | { edges?: readonly Ref[] }
      | undefined;
    return !!v?.edges?.some((e) => e.__ref === nodeId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// StoreProxy

export class StoreProxy {
  constructor(readonly cache: FrameCache) {}

  /** Get a typed record proxy. Pass the FrameType to get type-checked
   *  field/link access. */
  get<T extends AnyType>(type: T, id: string | number): RecordProxy<T> | null;
  /** Untyped lookup by raw cache key (`"Type:id"`). */
  get(refId: string): RecordProxy<AnyType> | null;
  get<T extends AnyType>(typeOrRefId: T | string, id?: string | number): RecordProxy<T> | null {
    if (typeof typeOrRefId === "string") {
      return this.cache.records[typeOrRefId]
        ? (new RecordProxy(this.cache, typeOrRefId) as RecordProxy<T>)
        : null;
    }
    const ref = `${typeOrRefId.name}:${typeof id === "string" ? id : String(id)}`;
    return this.cache.records[ref] ? new RecordProxy<T>(this.cache, ref) : null;
  }

  /** Create a typed record. Pass the FrameType + (optional) id. */
  create<T extends AnyType>(type: T, id?: string): RecordProxy<T> {
    const actualId = id ?? `local_${++_localCounter}`;
    const ref = `${type.name}:${actualId}`;
    this.cache.ingestRecords({
      [ref]: { __typename: type.name, id: actualId },
    });
    return new RecordProxy<T>(this.cache, ref);
  }

  delete(refId: string): void {
    this.cache.deleteRecord(refId);
  }

  /** Mark every cached root for this request stale (background refetch on
   *  next read). */
  invalidateRequest(name: string): void {
    this.cache.invalidateRoots((key) => key.startsWith(`${name}(`));
  }

  invalidateAll(): void {
    this.cache.invalidateAll();
  }

  /** Every cached record of the given type. */
  records<T extends AnyType>(type: T): RecordProxy<T>[] {
    const prefix = `${type.name}:`;
    const out: RecordProxy<T>[] = [];
    for (const ref of Object.keys(this.cache.records)) {
      if (ref.startsWith(prefix)) out.push(new RecordProxy<T>(this.cache, ref));
    }
    return out;
  }

  /** Walk every connection in the cache and yield the ones matching `field`
   *  (optionally filtered by parent type and a predicate on args).
   *
   *  Use this when you've changed a record and need to update every cached
   *  variant of a connection that may contain it — e.g. after closing a task,
   *  splice it into all `tasks` connections whose filter args admit closed
   *  tasks, and remove it from all that don't. */
  findConnections<T extends AnyType = AnyType>(opts: {
    readonly field: string;
    readonly on?: T;
    readonly where?: (args: unknown, parent: RecordProxy<T>) => boolean;
  }): ConnectionProxy<AnyType>[] {
    const parentPrefix = opts.on ? `${opts.on.name}:` : "";
    const out: ConnectionProxy<AnyType>[] = [];
    for (const ref of Object.keys(this.cache.records)) {
      if (parentPrefix && !ref.startsWith(parentPrefix)) continue;
      const rec = this.cache.records[ref]!;
      for (const slot of Object.keys(rec)) {
        const parsed = parseSlot(slot);
        if (parsed.field !== opts.field) continue;
        if (!isConnectionValue(rec[slot])) continue;
        if (opts.where) {
          const parent = new RecordProxy<T>(this.cache, ref);
          if (!opts.where(parsed.args, parent)) continue;
        }
        out.push(new ConnectionProxy(this.cache, ref, slot));
      }
    }
    return out;
  }
}

let _localCounter = 0;

/** Build a cache key from a typename + id. */
export const refKey = (typename: string, id: string | number): string =>
  `${typename}:${typeof id === "string" ? id : String(id)}`;

/** Re-exports for convenience. */
export { storageKey, stableStringify };
