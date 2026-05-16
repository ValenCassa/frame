import { Data } from "effect";

export class UnknownQuery extends Data.TaggedError("UnknownQuery")<{
  readonly query: string;
}> {}

export class MissingResolver extends Data.TaggedError("MissingResolver")<{
  readonly query: string;
}> {}

export class MissingConnectionResolver extends Data.TaggedError("MissingConnectionResolver")<{
  readonly parent: string;
  readonly field: string;
}> {}

export class MissingConnectionField extends Data.TaggedError("MissingConnectionField")<{
  readonly query: string;
  readonly field: string;
}> {}

export class MissingId extends Data.TaggedError("MissingId")<{
  readonly typename: string;
}> {}

export class InvalidPayload extends Data.TaggedError("InvalidPayload")<{
  readonly reason: string;
}> {}

export type FrameError =
  | UnknownQuery
  | MissingResolver
  | MissingConnectionResolver
  | MissingConnectionField
  | MissingId
  | InvalidPayload;
