import { createContext, useContext, useMemo, type ReactNode } from "react";
import { FrameCache, makeCache } from "./cache";
import { httpTransport, type FrameTransport } from "./transport";

export interface FrameClient {
  readonly cache: FrameCache;
  readonly transport: FrameTransport;
  readonly pending: Map<string, Promise<unknown>>;
}

let _defaultClient: FrameClient | null = null;

/** Returns the process-wide default client (lazy-initialized). Used by
 *  request.prefetch() and as the fallback inside <FrameProvider>. */
export const getDefaultClient = (): FrameClient => {
  if (!_defaultClient) {
    _defaultClient = {
      cache: makeCache(),
      transport: httpTransport(),
      pending: new Map(),
    };
  }
  return _defaultClient;
};

/** Replace the process-wide default client. Useful in tests or to inject a
 *  custom transport for the whole app. */
export const setDefaultClient = (client: FrameClient): void => {
  _defaultClient = client;
};

const FrameContext = createContext<FrameClient | null>(null);

export interface FrameProviderProps {
  readonly children: ReactNode;
  /** Optional explicit client. If omitted, falls back to the default client. */
  readonly client?: FrameClient;
  /** Convenience: override the transport on a new client. */
  readonly transport?: FrameTransport;
  /** Convenience: override the cache on a new client. */
  readonly cache?: FrameCache;
}

export const FrameProvider = ({ children, client, transport, cache }: FrameProviderProps) => {
  const value = useMemo<FrameClient>(() => {
    if (client) return client;
    if (transport || cache) {
      return {
        cache: cache ?? makeCache(),
        transport: transport ?? httpTransport(),
        pending: new Map(),
      };
    }
    return getDefaultClient();
  }, [client, cache, transport]);
  return <FrameContext.Provider value={value}>{children}</FrameContext.Provider>;
};

export const useFrameClient = (): FrameClient => {
  const ctx = useContext(FrameContext);
  return ctx ?? getDefaultClient();
};
