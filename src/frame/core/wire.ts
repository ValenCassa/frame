import { Schema } from "effect";
import type { FieldDef, FrameType } from "./type";
import { isConnection, isPick, isSpread, type SelectionNode, type View } from "./view";

export type WireNode =
  | { readonly kind: "pick"; readonly field: string }
  | {
      readonly kind: "ref";
      readonly field: string;
      readonly args?: unknown;
      readonly typename: string;
      readonly selection: readonly WireNode[];
    }
  | {
      readonly kind: "list";
      readonly field: string;
      readonly args?: unknown;
      readonly typename: string;
      readonly selection: readonly WireNode[];
    }
  | {
      readonly kind: "connection";
      readonly field: string;
      readonly args?: unknown;
      readonly typename: string;
      readonly first?: number;
      readonly identity: readonly string[];
      readonly selection: readonly WireNode[];
    };

export const compileView = (
  view: View<FrameType<string, Record<string, FieldDef>>, unknown>,
): readonly WireNode[] => {
  const out: WireNode[] = [];
  const sel = view.selection as Record<string, SelectionNode>;
  for (const key of Object.keys(sel)) {
    const node = sel[key]!;
    if (isPick(node)) {
      out.push({ kind: "pick", field: node.field });
    } else if (isSpread(node)) {
      const sub = compileView(node.view);
      out.push({
        kind: node.kind,
        field: node.field,
        args: node.args,
        typename: node.view.type.name,
        selection: sub,
      });
    } else if (isConnection(node)) {
      const sub = compileView(node.view);
      out.push({
        kind: "connection",
        field: node.field,
        args: node.args,
        typename: node.view.type.name,
        first: node.first,
        identity: node.identity,
        selection: sub,
      });
    }
  }
  return out;
};

/** Stable JSON for cache keys. */
export const stableStringify = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => JSON.stringify(k) + ":" + stableStringify((v as Record<string, unknown>)[k]))
    .join(",")}}`;
};

/** Slot name for a field on a normalized record. Includes args when present. */
export const storageKey = (field: string, args: unknown): string =>
  args === undefined ? field : `${field}(${stableStringify(args)})`;

const WireNodeSchema: Schema.Schema<WireNode> = Schema.suspend(() =>
  Schema.Union(
    Schema.Struct({
      kind: Schema.Literal("pick"),
      field: Schema.String,
    }),
    Schema.Struct({
      kind: Schema.Literal("ref"),
      field: Schema.String,
      args: Schema.optional(Schema.Unknown),
      typename: Schema.String,
      selection: Schema.Array(WireNodeSchema),
    }),
    Schema.Struct({
      kind: Schema.Literal("list"),
      field: Schema.String,
      args: Schema.optional(Schema.Unknown),
      typename: Schema.String,
      selection: Schema.Array(WireNodeSchema),
    }),
    Schema.Struct({
      kind: Schema.Literal("connection"),
      field: Schema.String,
      args: Schema.optional(Schema.Unknown),
      typename: Schema.String,
      first: Schema.optional(Schema.Number),
      identity: Schema.Array(Schema.String),
      selection: Schema.Array(WireNodeSchema),
    }),
  ),
) as Schema.Schema<WireNode>;

export const ViewTreeSchema = Schema.Array(WireNodeSchema);

/** One field selection in a frontend query operation. */
export const WireFieldPickSchema = Schema.Struct({
  alias: Schema.String,
  field: Schema.String,
  args: Schema.Unknown,
  view: ViewTreeSchema,
});
export type WireFieldPick = Schema.Schema.Type<typeof WireFieldPickSchema>;

export const RequestPayloadSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("query"),
    operation: Schema.String,
    variables: Schema.Unknown,
    picks: Schema.Array(WireFieldPickSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal("paginate"),
    parent: Schema.String,
    field: Schema.String,
    fieldArgs: Schema.optional(Schema.Unknown),
    after: Schema.NullOr(Schema.String),
    first: Schema.Number,
    typename: Schema.String,
    view: ViewTreeSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("mutation"),
    name: Schema.String,
    input: Schema.Unknown,
    view: ViewTreeSchema,
  }),
);
export type RequestPayload = Schema.Schema.Type<typeof RequestPayloadSchema>;

export const ResponseEnvelopeSchema = Schema.Struct({
  records: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  result: Schema.Unknown,
});
export type ResponseEnvelope = Schema.Schema.Type<typeof ResponseEnvelopeSchema>;
