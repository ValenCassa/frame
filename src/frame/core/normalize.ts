export interface Ref {
  readonly __ref: string;
}

export const isRef = (v: unknown): v is Ref => typeof v === "object" && v !== null && "__ref" in v;

export interface ConnectionData {
  readonly __connection: true;
  readonly edges: readonly Ref[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly hasPreviousPage: boolean;
    readonly startCursor: string | null;
    readonly endCursor: string | null;
  };
}

export type RecordValue = unknown;
export type Records = Record<string, Record<string, RecordValue>>;
