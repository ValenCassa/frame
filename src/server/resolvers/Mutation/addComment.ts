import { Effect } from "effect";
import { defineMutation } from "@/frame/server";
import { addCommentMutation } from "@/server/schema/mutations";
import { Db } from "@/server/services/db";

export const addComment = defineMutation(addCommentMutation, ({ input }) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const newComment = yield* db.addComment(input.postId, input.content);
    const post = yield* db.postById(input.postId);
    return { newComment, post };
  }),
);
