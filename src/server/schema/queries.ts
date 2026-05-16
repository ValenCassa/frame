import { Schema } from "effect";
import { query } from "@/frame";
import { Post } from "./types";

/** Root queries the server can resolve. Frontend requests select among these. */

export const feedQuery = query("feed", {
  input: Schema.Struct({ category: Schema.String }),
  returns: Post,
  list: true,
});

export const postByIdQuery = query("postById", {
  input: Schema.Struct({ id: Schema.String }),
  returns: Post,
});
