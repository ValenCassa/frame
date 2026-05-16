import type { FieldDef, FrameType } from "../core/type";
import { isConnection, isPick, isSpread, type SelectionNode, type View } from "../core/view";
import { isRef, type Ref } from "../core/normalize";
import { storageKey } from "../core/wire";
import type { ViewKey } from "../core/view-key";
import type { FrameCache } from "./cache";

export type { ViewKey } from "../core/view-key";

export const makeKey = <V>(ref: Ref): ViewKey<V> =>
  ({ __frame_key: true, __ref: ref.__ref }) as ViewKey<V>;

const isConnectionData = (
  v: unknown,
): v is {
  __connection: true;
  edges: readonly Ref[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
} => typeof v === "object" && v !== null && (v as { __connection?: unknown }).__connection === true;

export const unmask = (
  cache: FrameCache,
  view: View<FrameType<string, Record<string, FieldDef>>, unknown>,
  key: ViewKey<unknown>,
): Record<string, unknown> => {
  const rec = cache.getRecord(key.__ref);
  if (!rec) return {};
  return readSelection(rec, view.selection as Record<string, SelectionNode>);
};

const readSelection = (
  rec: Record<string, unknown>,
  selection: Record<string, SelectionNode>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(selection)) {
    const node = selection[k]!;
    if (isPick(node)) {
      out[node.field] = rec[node.field];
    } else if (isSpread(node)) {
      const slot = storageKey(node.field, node.args);
      const v = rec[slot];
      if (node.kind === "ref") {
        if (v == null) {
          out[node.field] = null;
        } else if (isRef(v)) {
          out[node.field] = makeKey(v);
        }
      } else {
        if (!Array.isArray(v)) {
          out[node.field] = [];
        } else {
          out[node.field] = v.map((item) => (isRef(item) ? makeKey(item) : item));
        }
      }
    } else if (isConnection(node)) {
      const slot = storageKey(node.field, node.args);
      const v = rec[slot];
      if (isConnectionData(v)) {
        out[node.field] = {
          edges: v.edges.map((edgeRef) => ({ node: makeKey(edgeRef) })),
          pageInfo: v.pageInfo,
        };
      } else {
        out[node.field] = {
          edges: [],
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: null,
            endCursor: null,
          },
        };
      }
    }
  }
  return out;
};

/** Read one alias slot of a query operation's root value. */
export const readQuerySlot = (
  slot: Ref | readonly Ref[] | null | undefined,
  isList: boolean,
): unknown => {
  if (slot == null) return isList ? [] : null;
  if (isList) {
    if (!Array.isArray(slot)) return [];
    return slot.map((r) => makeKey(r));
  }
  if (Array.isArray(slot)) return null;
  return makeKey(slot as Ref);
};
