import type { Schema } from "effect";
import type { AnySchema, FieldDef, FrameType } from "./type";
import { registerQuery } from "./registry";

/** A root query the server can resolve — equivalent to GraphQL's
 *  `Query.fieldName(input): Returns`. Frontend requests select among these. */
export interface Query<
  Name extends string,
  Input,
  Returns extends FrameType<string, Record<string, FieldDef>>,
  IsList extends boolean = boolean,
> {
  readonly __frame: "query";
  readonly name: Name;
  readonly input: Schema.Schema<Input, any, any>;
  readonly returns: Returns;
  readonly isList: IsList;
}

export interface QueryOpts<
  InputSchema extends AnySchema,
  Returns extends FrameType<string, Record<string, FieldDef>>,
  IsList extends boolean,
> {
  readonly input: InputSchema;
  readonly returns: Returns;
  readonly list?: IsList;
}

export function query<
  Name extends string,
  InputSchema extends AnySchema,
  Returns extends FrameType<string, Record<string, FieldDef>>,
  IsList extends boolean = false,
>(
  name: Name,
  opts: QueryOpts<InputSchema, Returns, IsList>,
): Query<Name, InputSchema extends Schema.Schema<infer A, any, any> ? A : never, Returns, IsList> {
  const q: Query<
    Name,
    InputSchema extends Schema.Schema<infer A, any, any> ? A : never,
    Returns,
    IsList
  > = {
    __frame: "query",
    name,
    input: opts.input,
    returns: opts.returns,
    isList: (opts.list ?? false) as IsList,
  };
  registerQuery(
    q as unknown as Query<string, unknown, FrameType<string, Record<string, FieldDef>>, boolean>,
  );
  return q;
}
