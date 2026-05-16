import { Schema } from "effect";
import { mutation, payload, ref } from "@/frame";
import { Comment, Post } from "./types";

/** Payload returned by addComment — Relay-style wrapper carrying the new
 *  comment plus the updated post (so its commentCount / likes flow back). */
export const AddCommentPayload = payload("AddCommentPayload", {
  newComment: ref(() => Comment),
  post: ref(() => Post),
});

export const addCommentMutation = mutation("addComment", {
  input: Schema.Struct({
    postId: Schema.String,
    content: Schema.String,
  }),
  returns: AddCommentPayload,
});
