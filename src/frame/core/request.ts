import type { Schema } from "effect";
import type { AnySchema, FieldDef, FrameType } from "./type";
import type { Query } from "./query";
import type { View } from "./view";
import { registerRequest } from "./registry";

/** One query-selection inside a frontend Request: binds
 *  (query) + (runtime args) + (view selection). */
export interface QueryPick<
  Q extends Query<string, any, FrameType<string, Record<string, FieldDef>>, boolean>,
  V extends View<FrameType<string, Record<string, FieldDef>>, unknown>,
> {
  readonly __frame: "query-pick";
  readonly query: Q;
  readonly args: unknown;
  readonly view: V;
}

export const pick = <
  Q extends Query<string, any, FrameType<string, Record<string, FieldDef>>, boolean>,
  V extends View<FrameType<string, Record<string, FieldDef>>, unknown>,
>(
  q: Q,
  args: Q extends Query<string, infer I, any, any> ? I : never,
  view: V,
): QueryPick<Q, V> => ({
  __frame: "query-pick",
  query: q,
  args,
  view,
});

export const isQueryPick = (v: unknown): v is QueryPick<any, any> =>
  typeof v === "object" && v !== null && (v as { __frame?: unknown }).__frame === "query-pick";

/** A frontend request — a pure declaration of inputs + selection. Fetching
 *  policy (staleTime, fetchPolicy, refetchInterval) lives on `useRequest`. */
export interface Request<Name extends string, Args, Select> {
  readonly __frame: "request";
  readonly name: Name;
  readonly args: Schema.Schema<Args, any, any>;
  readonly buildSelect: (args: Args) => Select;
}

export interface RequestOpts<ArgsSchema extends AnySchema, Select> {
  readonly args: ArgsSchema;
  readonly select: (
    args: ArgsSchema extends Schema.Schema<infer A, any, any> ? A : never,
  ) => Select;
}

export function request<
  Name extends string,
  ArgsSchema extends AnySchema,
  Select extends Record<string, QueryPick<any, any>>,
>(
  name: Name,
  opts: RequestOpts<ArgsSchema, Select>,
): Request<Name, ArgsSchema extends Schema.Schema<infer A, any, any> ? A : never, Select> {
  const r: Request<
    Name,
    ArgsSchema extends Schema.Schema<infer A, any, any> ? A : never,
    Select
  > = {
    __frame: "request",
    name,
    args: opts.args,
    buildSelect: opts.select as never,
  };
  registerRequest(r as unknown as Request<string, unknown, Record<string, QueryPick<any, any>>>);
  return r;
}
