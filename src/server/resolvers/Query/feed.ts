import { Effect } from "effect";
import { defineQuery } from "@/frame/server";
import { feedQuery } from "@/server/schema/queries";
import { Db } from "@/server/services/db";

export const feed = defineQuery(feedQuery, ({ input }) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* db.feed(input.category);
  }),
);
