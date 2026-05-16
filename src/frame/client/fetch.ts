import type { FieldDef, FrameType } from "../core/type";
import type { Query } from "../core/query";
import type { QueryPick, Request } from "../core/request";
import { isQueryPick } from "../core/request";
import type { Mutation } from "../core/mutation";
import type { View } from "../core/view";
import {
  compileView,
  stableStringify,
  storageKey,
  type ResponseEnvelope,
  type WireFieldPick,
} from "../core/wire";
import type { Ref } from "../core/normalize";
import type { ViewKey } from "../core/view-key";
import { getDefaultClient, type FrameClient } from "./context";
import { makeKey, readQuerySlot } from "./unmask";
import { StoreProxy } from "./store-proxy";

type AnyView = View<FrameType<string, Record<string, FieldDef>>, unknown>;
type AnyQuery = Query<string, any, any, any>;
type AnyRequest = Request<string, any, Record<string, QueryPick<AnyQuery, AnyView>>>;

export const requestRootKey = (name: string, variables: unknown): string =>
  `${name}(${stableStringify(variables)})`;

const compileSelect = (
  select: Record<string, QueryPick<AnyQuery, AnyView>>,
): readonly WireFieldPick[] => {
  const out: WireFieldPick[] = [];
  for (const alias of Object.keys(select)) {
    const qp = select[alias]!;
    if (!isQueryPick(qp)) continue;
    out.push({
      alias,
      field: qp.query.name,
      args: qp.args,
      view: compileView(qp.view),
    });
  }
  return out;
};

/** Fire a Request via the client's transport and ingest into its cache. */
export const fetchAndIngest = (
  client: FrameClient,
  req: AnyRequest,
  variables: unknown,
  rootKey: string,
  staleTime: number = 0,
): Promise<void> => {
  const select = req.buildSelect(variables as never) as Record<
    string,
    QueryPick<AnyQuery, AnyView>
  >;
  const picks = compileSelect(select);
  const promise = client.transport
    .send({
      kind: "query",
      operation: req.name,
      variables,
      picks,
    })
    .then((env: ResponseEnvelope) => {
      client.cache.ingest(env.records as Record<string, Record<string, unknown>>, {
        key: rootKey,
        value: env.result as Record<string, Ref | readonly Ref[] | null>,
        staleTime,
      });
    })
    .finally(() => {
      client.pending.delete(rootKey);
    });
  client.pending.set(rootKey, promise);
  return promise;
};

/** Prime the cache for a request. Resolves when the data is in the cache.
 *  Idempotent: returns immediately on cache hit, joins the in-flight promise
 *  when there's a concurrent fetch for the same (name, args). */
export const prefetch = <
  R extends Request<string, any, Record<string, QueryPick<AnyQuery, AnyView>>>,
>(
  req: R,
  variables: R extends Request<string, infer A, any> ? A : never,
  opts?: { client?: FrameClient },
): Promise<void> => {
  const c = opts?.client ?? getDefaultClient();
  const rootKey = requestRootKey(req.name, variables);
  if (c.cache.hasRoot(rootKey)) return Promise.resolve();
  const inflight = c.pending.get(rootKey);
  if (inflight) return inflight as Promise<void>;
  return fetchAndIngest(c, req as AnyRequest, variables, rootKey);
};

// ─────────────────────────────────────────────────────────────────────────────
// Public programmatic API — Relay-style `fetchRequest` / `commitMutation`.
// These work outside React (event handlers, scripts, loaders, etc.).

type RequestArgs<R> = R extends Request<string, infer A, any> ? A : never;
type RequestSelect<R> = R extends Request<string, any, infer S> ? S : never;
type QueryPickData<P> =
  P extends QueryPick<infer Q, infer V>
    ? Q extends Query<any, any, any, infer IsList>
      ? IsList extends true
        ? ReadonlyArray<ViewKey<V>>
        : ViewKey<V>
      : never
    : never;
export type RequestData<R> = {
  readonly [K in keyof RequestSelect<R>]: QueryPickData<RequestSelect<R>[K]>;
};

/** Fetch a request and resolve with the typed result. Bypasses Suspense — use
 *  this in event handlers or non-React code paths. */
export const fetchRequest = async <
  R extends Request<string, any, Record<string, QueryPick<AnyQuery, AnyView>>>,
>(
  req: R,
  variables: RequestArgs<R>,
  opts?: { client?: FrameClient; force?: boolean },
): Promise<RequestData<R>> => {
  const c = opts?.client ?? getDefaultClient();
  const rootKey = requestRootKey(req.name, variables);

  const needsFetch = opts?.force || !c.cache.hasRoot(rootKey) || c.cache.isStale(rootKey);
  if (needsFetch) {
    const inflight = c.pending.get(rootKey);
    await (inflight ?? fetchAndIngest(c, req as AnyRequest, variables, rootKey));
  }

  const root = c.cache.getRoot(rootKey) as Record<string, Ref | readonly Ref[] | null>;
  const select = (req as AnyRequest).buildSelect(variables as never) as Record<
    string,
    QueryPick<AnyQuery, AnyView>
  >;
  const data: Record<string, unknown> = {};
  for (const alias of Object.keys(select)) {
    data[alias] = readQuerySlot(root[alias], select[alias]!.query.isList);
  }
  return data as RequestData<R>;
};

// ─────────────────────────────────────────────────────────────────────────────
// commitMutation — same impl backing useMutation's commit callback.

type MutationInput<M> = M extends Mutation<any, infer I, any> ? I : never;

export type CommitResult<V> = ViewKey<V> | Record<string, unknown>;

export interface ConnectionInsert {
  readonly parent: ViewKey<unknown> | string;
  readonly field: string;
  readonly args?: unknown;
  readonly where: "prepend" | "append";
  readonly from?: string;
}

export interface CommitMutationOpts<M, V> {
  readonly input: MutationInput<M>;
  readonly optimistic?: Record<string, unknown> & { readonly id?: string };
  readonly optimisticTypename?: string;
  readonly connections?: readonly ConnectionInsert[];
  readonly updater?: (store: StoreProxy, result: CommitResult<V>) => void;
  readonly client?: FrameClient;
}

let _optimisticCounter = 0;
const makeOptimisticRef = (typename: string): Ref => ({
  __ref: `${typename}:__optimistic__${++_optimisticCounter}`,
});
const refOf = (p: ViewKey<unknown> | string): string => (typeof p === "string" ? p : p.__ref);

/** Fire a mutation outside React. Same semantics as `useMutation`'s commit
 *  callback (optimistic write, connection inserts, updater, real-response
 *  reconciliation). */
export const commitMutation = async <M extends Mutation<string, any, any>, V extends AnyView>(
  m: M,
  view: V,
  opts: CommitMutationOpts<M, V>,
): Promise<CommitResult<V>> => {
  const client = opts.client ?? getDefaultClient();
  const returns = (m as Mutation<string, any, FrameType<string, Record<string, FieldDef>>>).returns;
  const isPayload = returns.transient;
  const optimisticTypename = opts.optimisticTypename ?? returns.name;
  const conns = opts.connections ?? [];

  let optimisticRef: Ref | null = null;
  if (opts.optimistic) {
    optimisticRef = makeOptimisticRef(optimisticTypename);
    client.cache.ingestRecords({
      [optimisticRef.__ref]: {
        __typename: optimisticTypename,
        id: opts.optimistic.id ?? optimisticRef.__ref,
        ...opts.optimistic,
      },
    });
    for (const c of conns) {
      client.cache.insertConnection(
        refOf(c.parent),
        storageKey(c.field, c.args),
        optimisticRef,
        c.where,
      );
    }
  }

  try {
    const env = await client.transport.send({
      kind: "mutation",
      name: m.name,
      input: opts.input,
      view: compileView(view),
    });

    client.cache.ingestRecords(env.records as Record<string, Record<string, unknown>>);

    const pickRealRef = (c: ConnectionInsert): Ref | null => {
      if (isPayload) {
        const obj = env.result as Record<string, unknown> | null;
        if (!obj || !c.from) return null;
        return (obj[c.from] as Ref | null) ?? null;
      }
      return env.result as Ref | null;
    };

    if (optimisticRef) {
      for (const c of conns) {
        const realRef = pickRealRef(c);
        if (realRef) {
          client.cache.replaceInConnection(
            refOf(c.parent),
            storageKey(c.field, c.args),
            optimisticRef.__ref,
            realRef,
          );
        } else {
          client.cache.removeFromConnection(
            refOf(c.parent),
            storageKey(c.field, c.args),
            optimisticRef.__ref,
          );
        }
      }
      client.cache.deleteRecord(optimisticRef.__ref);
    } else {
      for (const c of conns) {
        const realRef = pickRealRef(c);
        if (realRef) {
          client.cache.insertConnection(
            refOf(c.parent),
            storageKey(c.field, c.args),
            realRef,
            c.where,
          );
        }
      }
    }

    let returnedData: CommitResult<V>;
    if (isPayload) {
      const obj = (env.result ?? {}) as Record<string, unknown>;
      const mapped: Record<string, unknown> = {};
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v && typeof v === "object" && "__ref" in v) {
          mapped[k] = makeKey(v as Ref);
        } else {
          mapped[k] = v;
        }
      }
      returnedData = mapped;
    } else {
      const ref = env.result as Ref | null;
      if (!ref) throw new Error("Mutation returned null");
      returnedData = makeKey(ref) as ViewKey<V>;
    }

    if (opts.updater) {
      opts.updater(new StoreProxy(client.cache), returnedData);
    }
    return returnedData;
  } catch (error) {
    if (optimisticRef) {
      for (const c of conns) {
        client.cache.removeFromConnection(
          refOf(c.parent),
          storageKey(c.field, c.args),
          optimisticRef.__ref,
        );
      }
      client.cache.deleteRecord(optimisticRef.__ref);
    }
    throw error;
  }
};
