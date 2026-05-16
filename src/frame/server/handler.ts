import { Effect, Layer, Match, Schema } from "effect";
import { getMutation, getQuery } from "../core/registry";
import type { Records, Ref } from "../core/normalize";
import { type WireNode, RequestPayloadSchema, storageKey } from "../core/wire";
import {
  InvalidPayload,
  MissingConnectionField,
  MissingConnectionResolver,
  MissingId,
  MissingResolver,
  UnknownQuery,
  type FrameError,
} from "../core/errors";
import {
  FrameRequest,
  lookupField,
  lookupMutation,
  lookupQuery,
  type ResolverMap,
} from "./resolver";

const toIdString = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
};

const findConnectionNode = (
  view: readonly WireNode[],
  field: string,
): Extract<WireNode, { kind: "connection" }> | undefined => {
  for (const n of view) {
    if (n.kind === "connection" && n.field === field) return n;
  }
  return undefined;
};

const emptyPageInfo = {
  hasNextPage: false,
  hasPreviousPage: false,
  startCursor: null,
  endCursor: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Recursive view executor (per-field).

const executeView = (
  resolvers: ResolverMap,
  records: Records,
  parentTypename: string,
  parentData: Record<string, unknown>,
  view: readonly WireNode[],
): Effect.Effect<Ref, FrameError | Error, any> =>
  Effect.gen(function* () {
    const id = parentData["id"];
    if (id == null) {
      return yield* new MissingId({ typename: parentTypename });
    }
    const key = `${parentTypename}:${toIdString(id)}`;
    const rec = records[key] ?? (records[key] = {});
    rec["__typename"] = parentTypename;
    rec["id"] = id;

    for (const node of view) {
      const slot =
        node.kind === "pick"
          ? node.field
          : storageKey(node.field, (node as { args?: unknown }).args);
      yield* writeNodeInto(resolvers, records, parentTypename, parentData, rec, slot, node);
    }

    return { __ref: key } satisfies Ref;
  });

/** Top-level executor for transient (payload) types. Walks the view, normalizes
 *  child entities into the records map, returns a plain structured object. */
const executeTransient = (
  resolvers: ResolverMap,
  records: Records,
  parentTypename: string,
  parentData: Record<string, unknown>,
  view: readonly WireNode[],
): Effect.Effect<Record<string, unknown>, FrameError | Error, any> =>
  Effect.gen(function* () {
    const result: Record<string, unknown> = {};
    for (const node of view) {
      yield* writeNodeInto(
        resolvers,
        records,
        parentTypename,
        parentData,
        result,
        node.field,
        node,
      );
    }
    return result;
  });

/** Per-node dispatcher: writes `target[slot]` based on the node kind. */
const writeNodeInto = (
  resolvers: ResolverMap,
  records: Records,
  parentTypename: string,
  parentData: Record<string, unknown>,
  target: Record<string, unknown>,
  slot: string,
  node: WireNode,
): Effect.Effect<void, FrameError | Error, any> =>
  Match.value(node).pipe(
    Match.when({ kind: "pick" }, (n) =>
      Effect.gen(function* () {
        const fieldResolver = lookupField(resolvers, parentTypename, n.field);
        if (fieldResolver) {
          target[slot] = yield* fieldResolver({ parent: parentData, args: undefined });
          return;
        }
        target[slot] = parentData[n.field];
      }),
    ),
    Match.when({ kind: "ref" }, (n) =>
      executeRefNode(resolvers, records, parentTypename, parentData, target, slot, n),
    ),
    Match.when({ kind: "list" }, (n) =>
      executeListNode(resolvers, records, parentTypename, parentData, target, slot, n),
    ),
    Match.when({ kind: "connection" }, (n) =>
      executeConnectionNode(resolvers, records, parentTypename, parentData, target, slot, n),
    ),
    Match.exhaustive,
  );

const executeRefNode = (
  resolvers: ResolverMap,
  records: Records,
  parentTypename: string,
  parentData: Record<string, unknown>,
  target: Record<string, unknown>,
  slot: string,
  node: Extract<WireNode, { kind: "ref" }>,
): Effect.Effect<void, FrameError | Error, any> =>
  Effect.gen(function* () {
    let value: unknown;
    const fieldResolver = lookupField(resolvers, parentTypename, node.field);
    if (fieldResolver) {
      value = yield* fieldResolver({ parent: parentData, args: node.args });
    } else if (node.args !== undefined) {
      return yield* new MissingConnectionResolver({
        parent: parentTypename,
        field: node.field,
      });
    } else if (node.field in parentData) {
      value = parentData[node.field];
    } else {
      return yield* new MissingConnectionResolver({
        parent: parentTypename,
        field: node.field,
      });
    }

    if (value == null) {
      target[slot] = null;
      return;
    }
    const childRef = yield* executeView(
      resolvers,
      records,
      node.typename,
      value as Record<string, unknown>,
      node.selection,
    );
    target[slot] = childRef;
  });

const executeListNode = (
  resolvers: ResolverMap,
  records: Records,
  parentTypename: string,
  parentData: Record<string, unknown>,
  target: Record<string, unknown>,
  slot: string,
  node: Extract<WireNode, { kind: "list" }>,
): Effect.Effect<void, FrameError | Error, any> =>
  Effect.gen(function* () {
    let value: unknown;
    const fieldResolver = lookupField(resolvers, parentTypename, node.field);
    if (fieldResolver) {
      value = yield* fieldResolver({ parent: parentData, args: node.args });
    } else if (node.args !== undefined) {
      return yield* new MissingConnectionResolver({
        parent: parentTypename,
        field: node.field,
      });
    } else if (node.field in parentData) {
      value = parentData[node.field];
    } else {
      return yield* new MissingConnectionResolver({
        parent: parentTypename,
        field: node.field,
      });
    }

    if (!Array.isArray(value)) {
      target[slot] = [];
      return;
    }
    const refs: Ref[] = [];
    for (const item of value) {
      const childRef = yield* executeView(
        resolvers,
        records,
        node.typename,
        item as Record<string, unknown>,
        node.selection,
      );
      refs.push(childRef);
    }
    target[slot] = refs;
  });

const executeConnectionNode = (
  resolvers: ResolverMap,
  records: Records,
  parentTypename: string,
  parentData: Record<string, unknown>,
  target: Record<string, unknown>,
  slot: string,
  node: Extract<WireNode, { kind: "connection" }>,
): Effect.Effect<void, FrameError | Error, any> =>
  Effect.gen(function* () {
    const fieldResolver = lookupField(resolvers, parentTypename, node.field);
    if (!fieldResolver) {
      return yield* new MissingConnectionResolver({
        parent: parentTypename,
        field: node.field,
      });
    }

    const result = (yield* fieldResolver({
      parent: parentData,
      args: node.args,
      after: null,
      first: node.first ?? 20,
    })) as {
      edges: ReadonlyArray<{ node: Record<string, unknown> }>;
      pageInfo: typeof emptyPageInfo;
    };

    const edges: Ref[] = [];
    for (const edge of result.edges) {
      const childRef = yield* executeView(
        resolvers,
        records,
        node.typename,
        edge.node,
        node.selection,
      );
      edges.push(childRef);
    }
    target[slot] = {
      __connection: true,
      edges,
      pageInfo: result.pageInfo,
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Top-level query operation: run each pick, aggregate.

const handleOperation = (
  resolvers: ResolverMap,
  picks: ReadonlyArray<{
    readonly alias: string;
    readonly field: string;
    readonly args: unknown;
    readonly view: readonly WireNode[];
  }>,
) =>
  Effect.gen(function* () {
    const records: Records = {};
    const result: Record<string, unknown> = {};

    for (const pick of picks) {
      const queryDecl = getQuery(pick.field);
      if (!queryDecl) {
        return yield* new UnknownQuery({ query: pick.field });
      }
      const queryResolver = lookupQuery(resolvers, pick.field);
      if (!queryResolver) {
        return yield* new MissingResolver({ query: pick.field });
      }
      const data = yield* queryResolver({ input: pick.args });
      const topTypename = queryDecl.returns.name;

      if (queryDecl.isList) {
        if (!Array.isArray(data)) {
          result[pick.alias] = [];
          continue;
        }
        const refs: Ref[] = [];
        for (const item of data) {
          const ref = yield* executeView(
            resolvers,
            records,
            topTypename,
            item as Record<string, unknown>,
            pick.view,
          );
          refs.push(ref);
        }
        result[pick.alias] = refs;
      } else {
        if (data == null) {
          result[pick.alias] = null;
          continue;
        }
        const ref = yield* executeView(
          resolvers,
          records,
          topTypename,
          data as Record<string, unknown>,
          pick.view,
        );
        result[pick.alias] = ref;
      }
    }
    return { records, result };
  });

const handlePaginate = (
  resolvers: ResolverMap,
  payload: {
    readonly parent: string;
    readonly field: string;
    readonly fieldArgs?: unknown;
    readonly after: string | null;
    readonly first: number;
    readonly typename: string;
    readonly view: readonly WireNode[];
  },
) =>
  Effect.gen(function* () {
    const [parentTypename] = payload.parent.split(":") as [string, string];
    const fieldResolver = lookupField(resolvers, parentTypename, payload.field);
    if (!fieldResolver) {
      return yield* new MissingConnectionResolver({
        parent: parentTypename,
        field: payload.field,
      });
    }
    const connNode = findConnectionNode(payload.view, payload.field);
    if (!connNode) {
      return yield* new MissingConnectionField({
        query: "paginate",
        field: payload.field,
      });
    }
    const parentId = payload.parent.slice(parentTypename.length + 1);
    const result = (yield* fieldResolver({
      parent: { id: parentId, __typename: parentTypename } as Record<string, unknown>,
      args: payload.fieldArgs,
      after: payload.after,
      first: payload.first,
    })) as {
      edges: ReadonlyArray<{ node: Record<string, unknown> }>;
      pageInfo: typeof emptyPageInfo;
    };

    const records: Records = {};
    const refs: Ref[] = [];
    for (const edge of result.edges) {
      const ref = yield* executeView(
        resolvers,
        records,
        connNode.typename,
        edge.node,
        connNode.selection,
      );
      refs.push(ref);
    }
    return { records, result: { edges: refs, pageInfo: result.pageInfo } };
  });

const handleMutation = (
  resolvers: ResolverMap,
  payload: {
    readonly name: string;
    readonly input: unknown;
    readonly view: readonly WireNode[];
  },
) =>
  Effect.gen(function* () {
    const decl = getMutation(payload.name);
    if (!decl) {
      return yield* new UnknownQuery({ query: payload.name });
    }
    const impl = lookupMutation(resolvers, payload.name);
    if (!impl) {
      return yield* new MissingResolver({ query: payload.name });
    }
    const data = yield* impl({ input: payload.input });
    const records: Records = {};
    if (data == null) return { records, result: null };
    if (decl.returns.transient) {
      const obj = yield* executeTransient(
        resolvers,
        records,
        decl.returns.name,
        data as Record<string, unknown>,
        payload.view,
      );
      return { records, result: obj };
    }
    const ref = yield* executeView(
      resolvers,
      records,
      decl.returns.name,
      data as Record<string, unknown>,
      payload.view,
    );
    return { records, result: ref };
  });

// ─────────────────────────────────────────────────────────────────────────────

const decodePayload = Schema.decodeUnknown(RequestPayloadSchema);

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const errorStatus = (e: FrameError): number =>
  Match.value(e).pipe(
    Match.tag("InvalidPayload", () => 400),
    Match.tag("UnknownQuery", () => 404),
    Match.tag("MissingResolver", () => 500),
    Match.tag("MissingConnectionResolver", () => 500),
    Match.tag("MissingConnectionField", () => 400),
    Match.tag("MissingId", () => 500),
    Match.exhaustive,
  );

const program = (resolvers: ResolverMap) =>
  Effect.gen(function* () {
    const request = yield* FrameRequest;
    const body = yield* Effect.tryPromise({
      try: () => request.json(),
      catch: () => new InvalidPayload({ reason: "Invalid JSON" }),
    });
    const payload = yield* decodePayload(body).pipe(
      Effect.mapError((e) => new InvalidPayload({ reason: String(e) })),
    );

    if (payload.kind === "paginate") {
      return yield* handlePaginate(resolvers, payload);
    }
    if (payload.kind === "mutation") {
      return yield* handleMutation(resolvers, payload);
    }
    return yield* handleOperation(resolvers, payload.picks);
  });

export interface FrameHandlerOptions {
  readonly resolvers: ResolverMap;
  readonly layer?: Layer.Layer<any, never, never>;
}

export const handleFrameRequest = async (
  request: Request,
  options: FrameHandlerOptions,
): Promise<Response> => {
  const requestLayer = Layer.succeed(FrameRequest, request);
  const fullLayer: Layer.Layer<any, never, never> = options.layer
    ? Layer.merge(requestLayer, options.layer)
    : requestLayer;

  const provided = (
    program(options.resolvers) as Effect.Effect<unknown, FrameError | Error, any>
  ).pipe(Effect.provide(fullLayer)) as Effect.Effect<unknown, FrameError | Error, never>;

  const exit = await Effect.runPromiseExit(
    provided.pipe(
      Effect.catchAll((e) => Effect.succeed({ __error: e, status: errorStatus(e as FrameError) })),
      Effect.catchAllDefect((d) =>
        Effect.succeed({
          __error: { _tag: "Defect", message: String(d) } as const,
          status: 500,
        }),
      ),
    ),
  );

  if (exit._tag === "Failure") {
    return jsonResponse(500, { error: "Unexpected failure" });
  }
  const value = exit.value as
    | { records: Records; result: unknown }
    | { __error: { _tag: string }; status: number };

  if ("__error" in value) {
    return jsonResponse(value.status, { error: value.__error });
  }
  return jsonResponse(200, value);
};
