import type { Schema } from "effect";
import { registerType } from "./registry";

export type AnySchema = Schema.Schema<any, any, any>;

export type FieldDef =
  | { readonly kind: "scalar"; readonly schema: AnySchema }
  | {
      readonly kind: "ref";
      readonly target: () => FrameType<string, Record<string, FieldDef>>;
      readonly args?: AnySchema;
    }
  | {
      readonly kind: "list";
      readonly target: () => FrameType<string, Record<string, FieldDef>>;
      readonly args?: AnySchema;
    }
  | {
      readonly kind: "connection";
      readonly target: () => FrameType<string, Record<string, FieldDef>>;
      readonly args?: AnySchema;
    };

export interface FrameType<
  Name extends string,
  Fields extends Record<string, FieldDef>,
  Source = unknown,
> {
  readonly __frame: "type";
  readonly name: Name;
  readonly fields: Fields;
  /** Phantom — carries the declared source type at the type level. */
  readonly __source?: Source;
  /** Transient types (declared via `payload()`) are not normalized into the
   *  cache. Their fields' children still are. */
  readonly transient: boolean;
  /** Declare the upstream "source" shape — what your root/parent resolver
   *  returns for this type. Frame uses it to type `parent` in field
   *  resolvers and to require resolvers for fields the source doesn't
   *  cover. Type-level only, no runtime effect. */
  source<S>(): FrameType<Name, Fields, S>;
}

const makeFrameType = <const Fields extends Record<string, FieldDef>, Name extends string>(
  name: Name,
  fields: Fields,
  transient: boolean,
): FrameType<Name, Fields> => {
  const t: FrameType<Name, Fields> = {
    __frame: "type",
    name,
    fields,
    transient,
    source<S>() {
      return this as unknown as FrameType<Name, Fields, S>;
    },
  };
  registerType(t as unknown as FrameType<string, Record<string, FieldDef>>);
  return t;
};

export const type = <const Fields extends Record<string, FieldDef>, Name extends string>(
  name: Name,
  fields: Fields,
): FrameType<Name, Fields> => makeFrameType(name, fields, false);

/** Declare a transient payload type — a structural wrapper used as a mutation
 *  return value. The payload itself is not cached; its referenced entities
 *  (refs/lists/connections) are normalized as usual. */
export const payload = <const Fields extends Record<string, FieldDef>, Name extends string>(
  name: Name,
  fields: Fields,
): FrameType<Name, Fields> => makeFrameType(name, fields, true);

/** Wrap a Schema as a scalar field. Use it for every primitive field. */
export const scalar = <A extends AnySchema>(
  schema: A,
): { readonly kind: "scalar"; readonly schema: A } => ({ kind: "scalar", schema });

export function ref<T extends FrameType<string, Record<string, FieldDef>>>(
  target: () => T,
): { readonly kind: "ref"; readonly target: () => T };
export function ref<T extends FrameType<string, Record<string, FieldDef>>, A extends AnySchema>(
  target: () => T,
  opts: { readonly args: A },
): { readonly kind: "ref"; readonly target: () => T; readonly args: A };
export function ref(target: () => any, opts?: { args?: AnySchema }): FieldDef {
  return opts?.args ? { kind: "ref", target, args: opts.args } : { kind: "ref", target };
}

export function list<T extends FrameType<string, Record<string, FieldDef>>>(
  target: () => T,
): { readonly kind: "list"; readonly target: () => T };
export function list<T extends FrameType<string, Record<string, FieldDef>>, A extends AnySchema>(
  target: () => T,
  opts: { readonly args: A },
): { readonly kind: "list"; readonly target: () => T; readonly args: A };
export function list(target: () => any, opts?: { args?: AnySchema }): FieldDef {
  return opts?.args ? { kind: "list", target, args: opts.args } : { kind: "list", target };
}

export function connection<T extends FrameType<string, Record<string, FieldDef>>>(
  target: () => T,
): { readonly kind: "connection"; readonly target: () => T };
export function connection<
  T extends FrameType<string, Record<string, FieldDef>>,
  A extends AnySchema,
>(
  target: () => T,
  opts: { readonly args: A },
): { readonly kind: "connection"; readonly target: () => T; readonly args: A };
export function connection(target: () => any, opts?: { args?: AnySchema }): FieldDef {
  return opts?.args
    ? { kind: "connection", target, args: opts.args }
    : { kind: "connection", target };
}
