import type { Schema } from "effect";
import type { AnySchema, FieldDef, FrameType } from "./type";
import { registerMutation } from "./registry";

/** A server mutation — declarative shape mirrors `query()` but the runtime
 *  flows differently: no caching by args, results normalize into the cache so
 *  any view reading those records re-renders. */
export interface Mutation<
  Name extends string,
  Input,
  Returns extends FrameType<string, Record<string, FieldDef>>,
> {
  readonly __frame: "mutation";
  readonly name: Name;
  readonly input: Schema.Schema<Input, any, any>;
  readonly returns: Returns;
}

export interface MutationOpts<
  InputSchema extends AnySchema,
  Returns extends FrameType<string, Record<string, FieldDef>>,
> {
  readonly input: InputSchema;
  readonly returns: Returns;
}

export function mutation<
  Name extends string,
  InputSchema extends AnySchema,
  Returns extends FrameType<string, Record<string, FieldDef>>,
>(
  name: Name,
  opts: MutationOpts<InputSchema, Returns>,
): Mutation<Name, InputSchema extends Schema.Schema<infer A, any, any> ? A : never, Returns> {
  const m: Mutation<
    Name,
    InputSchema extends Schema.Schema<infer A, any, any> ? A : never,
    Returns
  > = {
    __frame: "mutation",
    name,
    input: opts.input,
    returns: opts.returns,
  };
  registerMutation(
    m as unknown as Mutation<string, unknown, FrameType<string, Record<string, FieldDef>>>,
  );
  return m;
}
