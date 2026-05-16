import type { FieldDef, FrameType } from "./type";
import type { Query } from "./query";
import type { Mutation } from "./mutation";
import type { QueryPick, Request } from "./request";

type AnyFrameType = FrameType<string, Record<string, FieldDef>>;
type AnyQuery = Query<string, unknown, AnyFrameType, boolean>;
type AnyMutation = Mutation<string, unknown, AnyFrameType>;
type AnyRequest = Request<string, unknown, Record<string, QueryPick<any, any>>>;

const types = new Map<string, AnyFrameType>();
const queries = new Map<string, AnyQuery>();
const mutations = new Map<string, AnyMutation>();
const requests = new Map<string, AnyRequest>();

/** Replace on duplicate. The intentional reason: HMR re-runs schema modules,
 *  producing a fresh value with the same name — we want the latest one to win,
 *  not crash. */
export const registerType = (t: AnyFrameType): void => {
  types.set(t.name, t);
};
export const getType = (name: string) => types.get(name);
export const allTypes = () => Array.from(types.values());

export const registerQuery = (q: AnyQuery): void => {
  queries.set(q.name, q);
};
export const getQuery = (name: string) => queries.get(name);
export const allQueries = () => Array.from(queries.values());

export const registerMutation = (m: AnyMutation): void => {
  mutations.set(m.name, m);
};
export const getMutation = (name: string) => mutations.get(name);
export const allMutations = () => Array.from(mutations.values());

export const registerRequest = (r: AnyRequest): void => {
  requests.set(r.name, r);
};
export const getRequest = (name: string) => requests.get(name);
export const allRequests = () => Array.from(requests.values());
