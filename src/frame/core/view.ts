import type { FieldDef, FrameType } from "./type";

export const PICK = Symbol.for("frame.pick");
export const SPREAD = Symbol.for("frame.spread");
export const CONNECTION = Symbol.for("frame.connection");

export interface PickNode<Field extends string = string, Out = unknown> {
  readonly [PICK]: true;
  readonly field: Field;
  readonly __out?: Out;
}

export interface SpreadNode<V = unknown, Kind extends "ref" | "list" = "ref" | "list"> {
  readonly [SPREAD]: true;
  readonly field: string;
  readonly args?: unknown;
  readonly view: View<FrameType<string, Record<string, FieldDef>>, unknown>;
  readonly kind: Kind;
  readonly __view?: V;
}

export interface ConnectionNode<V = unknown> {
  readonly [CONNECTION]: true;
  readonly field: string;
  readonly args?: unknown;
  readonly view: View<FrameType<string, Record<string, FieldDef>>, unknown>;
  readonly first?: number;
  readonly identity: readonly string[];
  readonly __view?: V;
}

export type SelectionNode = PickNode | SpreadNode | ConnectionNode;

export interface View<
  T extends FrameType<string, Record<string, FieldDef>>,
  Selection,
  Refetchable extends boolean = boolean,
> {
  readonly __frame: "view";
  readonly name: string;
  readonly type: T;
  readonly selection: Selection;
  readonly refetchable: Refetchable;
}

/** True if the selection contains at least one ConnectionNode. */
export type HasConnection<S> =
  S extends Record<string, infer N>
    ? Extract<N, ConnectionNode> extends never
      ? false
      : true
    : false;

type ScalarOut<S> = S extends { readonly Type: infer A } ? A : unknown;
type ArgsOf<S> = S extends { readonly Type: infer A } ? A : never;

type ScalarProxy<F extends { kind: "scalar"; schema: any }> = PickNode<
  string,
  ScalarOut<F["schema"]>
>;

type RefMethods<R extends FrameType<string, Record<string, FieldDef>>> = {
  /** Spread a named view. */
  spread<V extends View<R, unknown>>(view: V): SpreadNode<V, "ref">;
  /** Spread an inline selection — same shape as the `view()` builder. */
  spread<S extends Record<string, SelectionNode>>(
    build: (p: Builder<R>) => S,
  ): SpreadNode<View<R, S>, "ref">;
};

type ListMethods<R extends FrameType<string, Record<string, FieldDef>>> = {
  spread<V extends View<R, unknown>>(view: V): SpreadNode<V, "list">;
  spread<S extends Record<string, SelectionNode>>(
    build: (p: Builder<R>) => S,
  ): SpreadNode<View<R, S>, "list">;
};

type ConnectionMethods<R extends FrameType<string, Record<string, FieldDef>>> = {
  connection<V extends View<R, unknown>>(
    view: V,
    opts?: { first?: number; identity?: readonly string[] },
  ): ConnectionNode<V>;
  connection<S extends Record<string, SelectionNode>>(
    build: (p: Builder<R>) => S,
    opts?: { first?: number; identity?: readonly string[] },
  ): ConnectionNode<View<R, S>>;
};

type FieldProxy<F> = F extends { kind: "scalar"; schema: any }
  ? ScalarProxy<F>
  : F extends { kind: "ref"; target: () => infer R; args: infer A }
    ? R extends FrameType<string, Record<string, FieldDef>>
      ? (args: ArgsOf<A>) => RefMethods<R>
      : never
    : F extends { kind: "ref"; target: () => infer R }
      ? R extends FrameType<string, Record<string, FieldDef>>
        ? RefMethods<R>
        : never
      : F extends { kind: "list"; target: () => infer R; args: infer A }
        ? R extends FrameType<string, Record<string, FieldDef>>
          ? (args: ArgsOf<A>) => ListMethods<R>
          : never
        : F extends { kind: "list"; target: () => infer R }
          ? R extends FrameType<string, Record<string, FieldDef>>
            ? ListMethods<R>
            : never
          : F extends { kind: "connection"; target: () => infer R; args: infer A }
            ? R extends FrameType<string, Record<string, FieldDef>>
              ? (args: ArgsOf<A>) => ConnectionMethods<R>
              : never
            : F extends { kind: "connection"; target: () => infer R }
              ? R extends FrameType<string, Record<string, FieldDef>>
                ? ConnectionMethods<R>
                : never
              : never;

type Builder<T extends FrameType<string, Record<string, FieldDef>>> = {
  readonly [K in keyof T["fields"]]: FieldProxy<T["fields"][K]>;
} & {
  include<S>(view: View<T, S>): S;
};

const isView = (v: unknown): v is View<FrameType<string, Record<string, FieldDef>>, unknown> =>
  typeof v === "object" && v !== null && (v as { __frame?: unknown }).__frame === "view";

const resolveSubView = (
  arg: unknown,
  target: () => FrameType<string, Record<string, FieldDef>>,
): View<FrameType<string, Record<string, FieldDef>>, unknown> => {
  if (isView(arg)) return arg;
  if (typeof arg === "function") {
    return view(
      target(),
      arg as (
        p: Builder<FrameType<string, Record<string, FieldDef>>>,
      ) => Record<string, SelectionNode>,
    ) as View<FrameType<string, Record<string, FieldDef>>, unknown>;
  }
  throw new Error("Frame: spread/connection requires a View or an inline builder function");
};

const makeRefMethods = (
  field: string,
  args: unknown,
  target: () => FrameType<string, Record<string, FieldDef>>,
) => ({
  spread(viewOrBuild: unknown) {
    const node: SpreadNode = {
      [SPREAD]: true,
      field,
      args,
      view: resolveSubView(viewOrBuild, target),
      kind: "ref",
    };
    return node;
  },
});

const makeListMethods = (
  field: string,
  args: unknown,
  target: () => FrameType<string, Record<string, FieldDef>>,
) => ({
  spread(viewOrBuild: unknown) {
    const node: SpreadNode = {
      [SPREAD]: true,
      field,
      args,
      view: resolveSubView(viewOrBuild, target),
      kind: "list",
    };
    return node;
  },
});

const makeConnectionMethods = (
  field: string,
  args: unknown,
  target: () => FrameType<string, Record<string, FieldDef>>,
) => ({
  connection(viewOrBuild: unknown, opts?: { first?: number; identity?: readonly string[] }) {
    const node: ConnectionNode = {
      [CONNECTION]: true,
      field,
      args,
      view: resolveSubView(viewOrBuild, target),
      first: opts?.first,
      identity: opts?.identity ?? [],
    };
    return node;
  },
});

const makeBuilder = <T extends FrameType<string, Record<string, FieldDef>>>(t: T): Builder<T> => {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === "include") {
        return (sub: View<T, unknown>) => sub.selection;
      }
      const field = String(prop);
      const def = t.fields[field as keyof typeof t.fields] as FieldDef | undefined;
      if (!def) return undefined;
      if (def.kind === "scalar") {
        const node: PickNode = { [PICK]: true, field };
        return node;
      }
      if (def.kind === "ref") {
        if (def.args !== undefined) {
          return (args: unknown) => makeRefMethods(field, args, def.target);
        }
        return makeRefMethods(field, undefined, def.target);
      }
      if (def.kind === "list") {
        if (def.args !== undefined) {
          return (args: unknown) => makeListMethods(field, args, def.target);
        }
        return makeListMethods(field, undefined, def.target);
      }
      // connection
      if (def.args !== undefined) {
        return (args: unknown) => makeConnectionMethods(field, args, def.target);
      }
      return makeConnectionMethods(field, undefined, def.target);
    },
  };
  return new Proxy({}, handler) as Builder<T>;
};

let anonCounter = 0;

export interface ViewOpts<Refetchable extends boolean = false> {
  readonly name?: string;
  readonly refetchable?: Refetchable;
}

export function view<
  T extends FrameType<string, Record<string, FieldDef>>,
  Selection extends Record<string, SelectionNode>,
  Refetchable extends boolean = false,
>(
  type: T,
  build: (p: Builder<T>) => Selection,
  opts?: ViewOpts<Refetchable>,
): View<T, Selection, Refetchable> {
  const selection = build(makeBuilder(type));
  return {
    __frame: "view",
    name: opts?.name ?? `${type.name}View_${++anonCounter}`,
    type,
    selection,
    refetchable: (opts?.refetchable ?? false) as Refetchable,
  };
}

export const isPick = (n: unknown): n is PickNode =>
  typeof n === "object" && n !== null && PICK in n;
export const isSpread = (n: unknown): n is SpreadNode =>
  typeof n === "object" && n !== null && SPREAD in n;
export const isConnection = (n: unknown): n is ConnectionNode =>
  typeof n === "object" && n !== null && CONNECTION in n;
