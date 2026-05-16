import { Schema } from "effect";
import { connection, ref, scalar, type } from "@/frame";

export const User = type("User", {
  id: scalar(Schema.String),
  name: scalar(Schema.String),
  email: scalar(Schema.String),
  avatarUrl: scalar(Schema.String),
});

export const Comment = type("Comment", {
  id: scalar(Schema.String),
  content: scalar(Schema.String),
  createdAt: scalar(Schema.String),
  author: ref(() => User),
});

export const Post = type("Post", {
  id: scalar(Schema.String),
  title: scalar(Schema.String),
  excerpt: scalar(Schema.String),
  content: scalar(Schema.String),
  likes: scalar(Schema.Number),
  category: scalar(Schema.String),
  createdAt: scalar(Schema.String),
  author: ref(() => User),

  comments: connection(() => Comment, {
    args: Schema.Struct({ sortBy: Schema.Literal("newest", "oldest") }),
  }),
});
