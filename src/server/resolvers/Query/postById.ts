import { Effect } from "effect";
import { defineQuery } from "@/frame/server";
import { postByIdQuery } from "@/server/schema/queries";
import { Db } from "@/server/services/db";

export const postById = defineQuery(postByIdQuery, ({ input }) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* db.postById(input.id);
  }),
);
