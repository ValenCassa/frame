import { Context, type Effect } from "effect";
import type { FieldDef, FrameType } from "../core/type";
import type { Query } from "../core/query";
import type { Mutation } from "../core/mutation";
import type { FrameError } from "../core/errors";

/** Effect service tag holding the incoming HTTP Request inside a resolver. */
export class FrameRequest extends Context.Tag("frame/Request")<FrameRequest, Request>() {}

// ─────────────────────────────────────────────────────────────────────────────
// Query resolvers (root queries)
// ─────────────────────────────────────────────────────────────────────────────

export interface QueryResolverArgs<Input> {
  readonly input: Input;
}

export type QueryResolverImpl<Input, R> = (
  args: QueryResolverArgs<Input>,
) => Effect.Effect<unknown, FrameError | Error, R>;

export interface QueryResolverDef {
  readonly __frame: "query-resolver";
  readonly queryName: string;
  readonly impl: QueryResolverImpl<unknown, any>;
}

export const defineQuery = <Name extends string, Input, R>(
  q: Query<Name, Input, any, any>,
  impl: QueryResolverImpl<Input, R>,
): QueryResolverDef => ({
  __frame: "query-resolver",
  queryName: q.name,
  impl: impl as QueryResolverImpl<unknown, any>,
});

// ─────────────────────────────────────────────────────────────────────────────
// Mutation resolvers
// ─────────────────────────────────────────────────────────────────────────────

export interface MutationResolverDef {
  readonly __frame: "mutation-resolver";
  readonly mutationName: string;
  readonly impl: QueryResolverImpl<unknown, any>;
}

export const defineMutation = <Name extends string, Input, R>(
  m: Mutation<Name, Input, any>,
  impl: QueryResolverImpl<Input, R>,
): MutationResolverDef => ({
  __frame: "mutation-resolver",
  mutationName: m.name,
  impl: impl as QueryResolverImpl<unknown, any>,
});

// ─────────────────────────────────────────────────────────────────────────────
// Type field resolvers: ref / list / connection
// ─────────────────────────────────────────────────────────────────────────────

type IdOf<T> = T extends { fields: { id: { kind: "scalar"; schema: { Type: infer A } } } }
  ? A
  : string;

type NameOf<T> = T extends { name: infer N } ? N : string;

export type FieldParent<T> = {
  readonly id: IdOf<T>;
  readonly __typename: NameOf<T>;
};

/** Public helper: derive the args type of a field at a given key. */
export type ArgsOf<T, K extends string> = T extends {
  fields: { [P in K]: { args: { Type: infer A } } };
}
  ? A
  : undefined;

interface ConnectionResult {
  readonly edges: ReadonlyArray<{ readonly node: Record<string, unknown> }>;
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly hasPreviousPage: boolean;
    readonly startCursor: string | null;
    readonly endCursor: string | null;
  };
}

/** Permissive field-resolver shape — used internally by the resolver map. */
type AnyFieldImpl = (args: any) => Effect.Effect<unknown, FrameError | Error, any>;

export type TypeResolverFields = Record<string, AnyFieldImpl>;

export interface TypeResolverDef {
  readonly __frame: "type-resolver";
  readonly typename: string;
  readonly fields: TypeResolverFields;
}

type SourceOf<T> = T extends FrameType<any, any, infer S> ? S : unknown;
type IsSourceSet<S> = unknown extends S ? false : true;

type ScalarTypeOf<F> = F extends { kind: "scalar"; schema: { Type: infer S } } ? S : never;

type RefTargetSource<F> = F extends {
  kind: "ref" | "list";
  target: () => infer R;
}
  ? R extends FrameType<any, any, any>
    ? IsSourceSet<SourceOf<R>> extends true
      ? SourceOf<R>
      : Record<string, unknown>
    : Record<string, unknown>
  : never;

type ScalarKeys<T extends FrameType<string, Record<string, FieldDef>>> = {
  [K in keyof T["fields"]]: T["fields"][K] extends { kind: "scalar" } ? K : never;
}[keyof T["fields"]];

type RefOrListKeys<T extends FrameType<string, Record<string, FieldDef>>> = {
  [K in keyof T["fields"]]: T["fields"][K] extends { kind: "ref" } | { kind: "list" } ? K : never;
}[keyof T["fields"]];

/** When no `.source<T>()` is declared, frame derives a default parent shape
 *  from the schema: scalars typed, refs/lists optional (because upstream
 *  resolvers may or may not have hydrated them), connections excluded
 *  (always need an explicit resolver). */
export type DefaultSource<T extends FrameType<string, Record<string, FieldDef>>> = {
  readonly [K in ScalarKeys<T>]: ScalarTypeOf<T["fields"][K]>;
} & {
  readonly [K in RefOrListKeys<T>]?: RefTargetSource<T["fields"][K]>;
};

/** Effective source shape — explicit `.source<T>()` if declared, otherwise
 *  the schema-derived default. */
export type ResolvedSource<T extends FrameType<string, Record<string, FieldDef>>> =
  IsSourceSet<SourceOf<T>> extends true ? SourceOf<T> : DefaultSource<T>;

/** What `parent` is typed as inside a field resolver. */
export type ResolverParent<T extends FrameType<string, Record<string, FieldDef>>> =
  ResolvedSource<T> & { readonly __typename: NameOf<T> };

type ArgsTypeOf<F> = F extends { args: { Type: infer A } } ? A : undefined;

/** The resolver signature for one field, derived from its declarator. */
export type FieldImpl<T extends FrameType<string, Record<string, FieldDef>>, F> = F extends {
  kind: "scalar";
  schema: { Type: infer S };
}
  ? (args: {
      parent: ResolverParent<T>;
      args: undefined;
    }) => Effect.Effect<S, FrameError | Error, any>
  : F extends { kind: "ref" }
    ? (args: {
        parent: ResolverParent<T>;
        args: ArgsTypeOf<F>;
      }) => Effect.Effect<Record<string, unknown> | null, FrameError | Error, any>
    : F extends { kind: "list" }
      ? (args: {
          parent: ResolverParent<T>;
          args: ArgsTypeOf<F>;
        }) => Effect.Effect<ReadonlyArray<Record<string, unknown>>, FrameError | Error, any>
      : F extends { kind: "connection" }
        ? (args: {
            parent: ResolverParent<T>;
            args: ArgsTypeOf<F>;
            after: string | null;
            first: number;
          }) => Effect.Effect<ConnectionResult, FrameError | Error, any>
        : never;

/** A field is required when no default resolver could possibly cover it:
 *  connections, fields with args, or fields whose name isn't a key of the
 *  resolved source (explicit `.source<T>()` if declared, otherwise the
 *  schema-derived default — see {@link DefaultSource}). */
type FieldIsRequired<T extends FrameType<string, Record<string, FieldDef>>, K, F> = F extends {
  kind: "connection";
}
  ? true
  : F extends { args: any }
    ? true
    : K extends keyof ResolvedSource<T>
      ? false
      : true;

type OptionalKeys<T extends FrameType<string, Record<string, FieldDef>>> = {
  [K in keyof T["fields"]]: FieldIsRequired<T, K, T["fields"][K]> extends true ? never : K;
}[keyof T["fields"]];

type RequiredKeys<T extends FrameType<string, Record<string, FieldDef>>> = {
  [K in keyof T["fields"]]: FieldIsRequired<T, K, T["fields"][K]> extends true ? K : never;
}[keyof T["fields"]];

/** Strongly-typed resolver map for a FrameType — keys must be real fields,
 *  each value gets a per-kind signature inferred from the declarator.
 *  Required vs optional is inferred from the source shape. */
export type TypeResolverImpl<T extends FrameType<string, Record<string, FieldDef>>> = {
  readonly [K in OptionalKeys<T>]?: FieldImpl<T, T["fields"][K]>;
} & {
  readonly [K in RequiredKeys<T>]: FieldImpl<T, T["fields"][K]>;
};

export const defineType = <T extends FrameType<string, Record<string, FieldDef>>>(type: T) => {
  return (fields: TypeResolverImpl<T>): TypeResolverDef => ({
    __frame: "type-resolver",
    typename: type.name,
    fields: fields as TypeResolverFields,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Resolver map
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolverMap {
  /** Resolvers for root queries. Key matches the query name declared via `query()`. */
  readonly Query?: Record<string, QueryResolverDef>;
  /** Resolvers for mutations. Key matches the mutation name declared via `mutation()`. */
  readonly Mutation?: Record<string, MutationResolverDef>;
  /** Resolvers attached to types — connection / args-bearing fields. */
  readonly [typename: string]:
    | Record<string, QueryResolverDef>
    | Record<string, MutationResolverDef>
    | TypeResolverDef
    | undefined;
}

export const lookupQuery = (
  map: ResolverMap,
  queryName: string,
): QueryResolverImpl<unknown, any> | undefined => {
  const q = map.Query;
  if (!q) return undefined;
  const def = q[queryName];
  return def?.impl;
};

export const lookupMutation = (
  map: ResolverMap,
  mutationName: string,
): QueryResolverImpl<unknown, any> | undefined => {
  const m = map.Mutation;
  if (!m) return undefined;
  const def = m[mutationName];
  return def?.impl;
};

export const lookupField = (
  map: ResolverMap,
  typename: string,
  field: string,
): ((args: any) => Effect.Effect<unknown, any, any>) | undefined => {
  const entry = map[typename];
  if (!entry) return undefined;
  if (!("__frame" in entry)) return undefined;
  if (entry.__frame !== "type-resolver") return undefined;
  return (entry as TypeResolverDef).fields[field];
};
