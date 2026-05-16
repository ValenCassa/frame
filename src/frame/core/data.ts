import type { ConnectionNode, PickNode, SelectionNode, SpreadNode, View } from "./view";
import type { ViewKey } from "./view-key";

export interface ConnectionPage<NodeData> {
  readonly edges: ReadonlyArray<{ readonly node: NodeData }>;
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly hasPreviousPage: boolean;
    readonly startCursor: string | null;
    readonly endCursor: string | null;
  };
}

type DataField<N> =
  N extends PickNode<any, infer Out>
    ? Out
    : N extends SpreadNode<infer V, infer Kind>
      ? V extends View<any, any>
        ? Kind extends "ref"
          ? ViewKey<V> | null
          : ReadonlyArray<ViewKey<V>>
        : never
      : N extends ConnectionNode<infer V>
        ? V extends View<any, any>
          ? ConnectionPage<ViewKey<V>>
          : never
        : never;

export type Data<V> =
  V extends View<any, infer Selection>
    ? Selection extends Record<string, SelectionNode>
      ? { readonly [K in keyof Selection]: DataField<Selection[K]> }
      : never
    : never;
