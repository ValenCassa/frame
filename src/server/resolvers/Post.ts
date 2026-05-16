import { Effect } from "effect";
import { defineType } from "@/frame/server";
import { Post as PostType } from "@/server/schema/types";
import { Db } from "@/server/services/db";

export const Post = defineType(PostType)({
  comments: ({ parent, args, after, first }) =>
    Effect.gen(function* () {
      const db = yield* Db;
      return yield* db.commentsPage(parent.id, args.sortBy, after, first);
    }),
});
