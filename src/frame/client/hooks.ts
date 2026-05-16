import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FieldDef, FrameType } from "../core/type";
import type { Query } from "../core/query";
import type { QueryPick, Request } from "../core/request";
import { isConnection, type HasConnection, type SelectionNode, type View } from "../core/view";
import { compileView, storageKey } from "../core/wire";
import type { Data } from "../core/data";
import type { ViewKey } from "../core/view-key";
import type { Ref } from "../core/normalize";
import { useFrameClient, type FrameClient } from "./context";
import { fetchAndIngest, requestRootKey } from "./fetch";
import { StoreProxy } from "./store-proxy";
import { readQuerySlot, unmask } from "./unmask";

type AnyView = View<FrameType<string, Record<string, FieldDef>>, unknown>;
type AnyKey = ViewKey<unknown>;
type AnyQuery = Query<string, any, any, any>;
type AnyRequest = Request<string, any, Record<string, QueryPick<AnyQuery, AnyView>>>;

const useCacheSubscription = (client: FrameClient): void => {
  useSyncExternalStore(
    useCallback((onChange) => client.cache.subscribe(onChange), [client.cache]),
    () => client.cache.records,
    () => client.cache.records,
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// useRequest — runs a frontend Request, returns the multi-query result.

type RequestArgs<R> = R extends Request<any, infer A, any> ? A : never;
type RequestSelect<R> = R extends Request<any, any, infer S> ? S : never;

type QueryPickData<P> =
  P extends QueryPick<infer Q, infer V>
    ? Q extends Query<any, any, any, infer IsList>
      ? IsList extends true
        ? ReadonlyArray<ViewKey<V>>
        : ViewKey<V>
      : never
    : never;

type RequestData<R> = {
  readonly [K in keyof RequestSelect<R>]: QueryPickData<RequestSelect<R>[K]>;
};

export interface UseRequestResult<R extends AnyRequest> {
  readonly data: RequestData<R>;
  readonly refetch: () => Promise<void>;
  readonly isStale: boolean;
}

/** How `useRequest` resolves cached vs network data, modeled after Apollo's
 *  fetchPolicy. */
export type FetchPolicy =
  /** Return cached if present; on cache miss, network. Stale data is fine
   *  (no background refetch). */
  | "cache-first"
  /** Return cached immediately if present; always kick off a background
   *  refetch. On cache miss, suspend. (Default.) */
  | "cache-and-network"
  /** Always suspend until a fresh fetch completes. Stale cache is ignored. */
  | "network-only"
  /** Return cached if present, never hit the network. Suspends forever on
   *  cache miss (use only when you know data is already there). */
  | "cache-only";

export interface UseRequestOpts<R> {
  /** Default 0 (always considered stale on mount under `cache-and-network`). */
  readonly staleTime?: number;
  /** Default `"cache-and-network"`. */
  readonly fetchPolicy?: FetchPolicy;
  /** Refetch on an interval. `number` ms, a function of current data, or
   *  `false`. Defaults to `false`. */
  readonly refetchInterval?: number | false | ((data: RequestData<R>) => number | false);
}

export function useRequest<R extends AnyRequest>(
  req: R,
  variables: RequestArgs<R>,
  opts?: UseRequestOpts<R>,
): UseRequestResult<R> {
  const client = useFrameClient();
  const rootKey = useMemo(() => requestRootKey(req.name, variables), [req.name, variables]);
  const staleTime = opts?.staleTime ?? 0;
  const policy: FetchPolicy = opts?.fetchPolicy ?? "cache-and-network";

  useCacheSubscription(client);

  const hasRoot = client.cache.hasRoot(rootKey);

  // Cache miss handling depends on policy.
  if (!hasRoot) {
    if (policy === "cache-only") {
      // No data, no network — return empty. Caller is expected to ensure
      // the cache was populated some other way.
      return {
        data: {} as RequestData<R>,
        refetch: () => Promise.resolve(),
        isStale: false,
      };
    }
    let promise = client.pending.get(rootKey);
    if (!promise) {
      promise = fetchAndIngest(client, req, variables, rootKey, staleTime);
    }
    throw promise;
  }

  // network-only: always suspend until fresh.
  if (policy === "network-only") {
    const isStale = client.cache.isStale(rootKey);
    if (isStale) {
      let promise = client.pending.get(rootKey);
      if (!promise) {
        promise = fetchAndIngest(client, req, variables, rootKey, staleTime);
      }
      throw promise;
    }
  }

  // cache-and-network: SWR — return cached, refetch in background if stale.
  const isStale = client.cache.isStale(rootKey);
  if (policy === "cache-and-network" && isStale && !client.pending.has(rootKey)) {
    void fetchAndIngest(client, req, variables, rootKey, staleTime);
  }

  const root = client.cache.getRoot(rootKey) as Record<string, Ref | readonly Ref[] | null>;
  const select = req.buildSelect(variables as never) as Record<
    string,
    QueryPick<AnyQuery, AnyView>
  >;
  const data: Record<string, unknown> = {};
  for (const alias of Object.keys(select)) {
    data[alias] = readQuerySlot(root[alias], select[alias]!.query.isList);
  }
  const typedData = data as RequestData<R>;

  const refetch = useCallback(
    () => fetchAndIngest(client, req, variables, rootKey, staleTime),
    [client, req, variables, rootKey, staleTime],
  );

  // refetchInterval — fire periodically while mounted.
  useEffect(() => {
    const ri = opts?.refetchInterval;
    if (!ri) return;
    const ms = typeof ri === "function" ? ri(typedData) : ri;
    if (typeof ms !== "number" || ms <= 0) return;
    const id = setInterval(() => {
      void fetchAndIngest(client, req, variables, rootKey, staleTime);
    }, ms);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, rootKey, opts?.refetchInterval]);

  return { data: typedData, refetch, isStale };
}

// ─────────────────────────────────────────────────────────────────────────────
// useView — read a typed slice for a single view.

export function useView<T extends FrameType<string, Record<string, FieldDef>>, S>(
  view: View<T, S>,
  key: ViewKey<View<T, S>>,
): Data<View<T, S>> {
  const client = useFrameClient();
  useCacheSubscription(client);
  return unmask(client.cache, view as AnyView, key as AnyKey) as Data<View<T, S>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// useStore — get a `StoreProxy` for imperative cache reads/writes.

/** Returns a `StoreProxy` for the current Frame client. Use it inside
 *  event handlers or `commitLocalUpdate` to read/write cache records. */
export function useStore(): StoreProxy {
  const client = useFrameClient();
  return new StoreProxy(client.cache);
}

/** Run an imperative cache update against the given client. Equivalent to
 *  Relay's `commitLocalUpdate(environment, updater)`. */
export const commitLocalUpdate = (
  client: FrameClient,
  updater: (store: StoreProxy) => void,
): void => {
  updater(new StoreProxy(client.cache));
};

// ─────────────────────────────────────────────────────────────────────────────
// useRefetchableView — refetch using a Request.

export interface UseRefetchableViewResult<V, Vars> {
  readonly data: Data<V>;
  readonly refetch: (variables: Vars) => Promise<void>;
  readonly isRefetching: boolean;
}

export function useRefetchableView<
  T extends FrameType<string, Record<string, FieldDef>>,
  S,
  R extends AnyRequest,
>(
  view: View<T, S, true>,
  refetchRequest: R,
  key: ViewKey<View<T, S, true>>,
): UseRefetchableViewResult<View<T, S, true>, RequestArgs<R>> {
  const client = useFrameClient();
  useCacheSubscription(client);
  const [isRefetching, setIsRefetching] = useState(false);

  const data = unmask(client.cache, view as AnyView, key as AnyKey) as Data<View<T, S>>;

  const refetch = useCallback(
    async (variables: RequestArgs<R>) => {
      setIsRefetching(true);
      try {
        const rootKey = requestRootKey(refetchRequest.name, variables);
        await fetchAndIngest(client, refetchRequest, variables, rootKey);
      } finally {
        setIsRefetching(false);
      }
    },
    [client, refetchRequest],
  );

  return { data, refetch, isRefetching };
}

// ─────────────────────────────────────────────────────────────────────────────
// usePaginationView — connection pagination. The view encodes the connection
// field + selection; no Request needed.

export interface UsePaginationViewResult<V> {
  readonly data: Data<V>;
  readonly loadNext: (count: number) => Promise<void>;
  readonly hasNext: boolean;
  readonly isLoadingNext: boolean;
}

const findConnectionField = (
  view: AnyView,
): { field: string; args: unknown; typename: string; view: AnyView } => {
  const sel = view.selection as Record<string, unknown>;
  for (const k of Object.keys(sel)) {
    const node = sel[k];
    if (isConnection(node)) {
      return { field: node.field, args: node.args, typename: node.view.type.name, view: node.view };
    }
  }
  throw new Error(`Frame: usePaginationView requires the view to declare a .connection(...) field`);
};

interface ConnectionShape {
  readonly edges: ReadonlyArray<{ readonly node: unknown }>;
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly hasPreviousPage: boolean;
    readonly startCursor: string | null;
    readonly endCursor: string | null;
  };
}

const emptyConnection: ConnectionShape = {
  edges: [],
  pageInfo: {
    hasNextPage: false,
    hasPreviousPage: false,
    startCursor: null,
    endCursor: null,
  },
};

export function usePaginationView<
  T extends FrameType<string, Record<string, FieldDef>>,
  S extends Record<string, SelectionNode>,
>(
  view: View<T, S, true> & (HasConnection<S> extends true ? unknown : never),
  key: ViewKey<View<T, S, true>>,
): UsePaginationViewResult<View<T, S, true>> {
  const client = useFrameClient();
  useCacheSubscription(client);
  const [isLoadingNext, setIsLoadingNext] = useState(false);
  const connInfo = useRef<{
    field: string;
    args: unknown;
    typename: string;
    view: AnyView;
  } | null>(null);
  if (!connInfo.current) {
    connInfo.current = findConnectionField(view as AnyView);
  }

  const data = unmask(client.cache, view as AnyView, key as AnyKey) as Data<View<T, S>>;

  const conn = ((data as Record<string, unknown>)[connInfo.current.field] ??
    emptyConnection) as ConnectionShape;

  const loadNext = useCallback(
    async (count: number) => {
      if (!conn.pageInfo.hasNextPage) return;
      setIsLoadingNext(true);
      try {
        const wireView = compileView(view as AnyView);
        const ci = connInfo.current!;
        const env = await client.transport.send({
          kind: "paginate",
          parent: (key as AnyKey).__ref,
          field: ci.field,
          fieldArgs: ci.args,
          after: conn.pageInfo.endCursor,
          first: count,
          typename: ci.typename,
          view: wireView,
        });
        const result = env.result as { edges: Ref[]; pageInfo: ConnectionShape["pageInfo"] } | null;
        if (result) {
          client.cache.appendConnection(
            (key as AnyKey).__ref,
            storageKey(ci.field, ci.args),
            env.records as Record<string, Record<string, unknown>>,
            result.edges,
            result.pageInfo,
          );
        }
      } finally {
        setIsLoadingNext(false);
      }
    },
    [client, view, key, conn],
  );

  return {
    data,
    loadNext,
    hasNext: conn.pageInfo.hasNextPage,
    isLoadingNext,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// useMutation — wraps commitMutation() with React state tracking.

import type { Mutation } from "../core/mutation";
import { commitMutation, type CommitMutationOpts, type CommitResult } from "./fetch";

export type { CommitResult, ConnectionInsert } from "./fetch";

export interface UseMutationState<V> {
  readonly data: CommitResult<V> | null;
  readonly isInFlight: boolean;
  readonly error: unknown;
}

export type CommitFn<M, V> = (
  opts: Omit<CommitMutationOpts<M, V>, "client">,
) => Promise<CommitResult<V>>;

export function useMutation<
  M extends Mutation<string, any, any>,
  V extends View<FrameType<string, Record<string, FieldDef>>, unknown>,
>(m: M, view: V): readonly [CommitFn<M, V>, UseMutationState<V>] {
  const client = useFrameClient();
  const [state, setState] = useState<UseMutationState<V>>({
    data: null,
    isInFlight: false,
    error: null,
  });

  const commit = useCallback<CommitFn<M, V>>(
    async (opts) => {
      setState({ data: null, isInFlight: true, error: null });
      try {
        const result = await commitMutation<M, V>(m, view, { ...opts, client });
        setState({ data: result, isInFlight: false, error: null });
        return result;
      } catch (error) {
        setState({ data: null, isInFlight: false, error });
        throw error;
      }
    },
    [client, m, view],
  );

  return [commit, state] as const;
}
