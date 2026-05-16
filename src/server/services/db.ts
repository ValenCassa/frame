import { Effect } from "effect";
import {
  comments as commentRows,
  commentsForPost,
  findPost,
  findUser,
  posts as postRows,
} from "../db";

const hydrateAuthor = (authorId: string) => {
  const u = findUser(authorId);
  if (!u) throw new Error(`Missing user ${authorId}`);
  return u;
};

const hydrateComment = (id: string) => {
  const c = commentRows.find((x) => x.id === id);
  if (!c) throw new Error(`Missing comment ${id}`);
  return {
    id: c.id,
    content: c.content,
    createdAt: c.createdAt,
    author: hydrateAuthor(c.authorId),
  };
};

export interface Page<T> {
  readonly edges: ReadonlyArray<{ readonly node: T }>;
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly hasPreviousPage: boolean;
    readonly startCursor: string | null;
    readonly endCursor: string | null;
  };
}

let _commentSeq = commentRows.length;

export class Db extends Effect.Service<Db>()("Db", {
  sync: () => ({
    addComment: (postId: string, content: string) =>
      Effect.sync(() => {
        _commentSeq += 1;
        const newRow = {
          id: `c${_commentSeq}`,
          content,
          createdAt: new Date().toISOString(),
          authorId: "u1",
          postId,
        };
        commentRows.push(newRow);
        return hydrateComment(newRow.id);
      }),
    feed: (category: string) =>
      Effect.sync(() =>
        postRows
          .filter((p) => p.category === category)
          .map((p) => ({
            id: p.id,
            title: p.title,
            excerpt: p.excerpt,
            likes: p.likes,
            category: p.category,
            createdAt: p.createdAt,
            author: hydrateAuthor(p.authorId),
          })),
      ),
    postById: (id: string) =>
      Effect.sync(() => {
        const p = findPost(id);
        if (!p) throw new Error(`Missing post ${id}`);
        const pageSize = 5;
        const all = commentsForPost(p.id).map((c) => hydrateComment(c.id));
        const page = all.slice(0, pageSize);
        return {
          id: p.id,
          title: p.title,
          excerpt: p.excerpt,
          content: p.content,
          likes: p.likes,
          category: p.category,
          createdAt: p.createdAt,
          author: hydrateAuthor(p.authorId),
          comments: {
            edges: page.map((node) => ({ node })),
            pageInfo: {
              hasNextPage: all.length > pageSize,
              hasPreviousPage: false,
              startCursor: page[0]?.id ?? null,
              endCursor: page[page.length - 1]?.id ?? null,
            },
          },
        };
      }),
    commentsPage: (
      postId: string,
      sortBy: "newest" | "oldest",
      after: string | null,
      first: number,
    ): Effect.Effect<Page<ReturnType<typeof hydrateComment>>> =>
      Effect.sync(() => {
        const all = commentsForPost(postId).map((c) => hydrateComment(c.id));
        if (sortBy === "oldest") all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        else all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        let startIndex = 0;
        if (after) {
          const idx = all.findIndex((c) => c.id === after);
          startIndex = idx >= 0 ? idx + 1 : 0;
        }
        const slice = all.slice(startIndex, startIndex + first);
        const endIndex = startIndex + slice.length;
        return {
          edges: slice.map((node) => ({ node })),
          pageInfo: {
            hasNextPage: endIndex < all.length,
            hasPreviousPage: startIndex > 0,
            startCursor: slice[0]?.id ?? null,
            endCursor: slice[slice.length - 1]?.id ?? null,
          },
        };
      }),
  }),
}) {}
