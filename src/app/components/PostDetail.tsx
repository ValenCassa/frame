import { useState } from "react";
import { useMutation, usePaginationView, view, type ViewKey } from "@/frame";
import { Post } from "@/server/schema/types";
import { addCommentMutation, AddCommentPayload } from "@/server/schema/mutations";
import { CommentView, CommentRow } from "./Comment";
import { PostCardView } from "./PostCard";
import { UserAvatar } from "./UserAvatar";

export const PostDetailView = view(
  Post,
  (p) => ({
    ...p.include(PostCardView),
    content: p.content,
    comments: p.comments({ sortBy: "newest" }).connection(CommentView, {
      first: 5,
      identity: [],
    }),
  }),
  { name: "PostDetailView", refetchable: true },
);

// View over the payload — selects shapes for the new comment AND the updated
// post. The updated post normalizes back into the existing Post:p1 record so
// any view reading it (e.g. PostCardView in the feed) reflects new likes /
// counts immediately.
const AddCommentResult = view(
  AddCommentPayload,
  (p) => ({
    newComment: p.newComment.spread(CommentView),
    post: p.post.spread(PostCardView),
  }),
  { name: "AddCommentResult" },
);

export function PostDetail({ post }: { post: ViewKey<typeof PostDetailView> }) {
  const { data, loadNext, hasNext, isLoadingNext } = usePaginationView(PostDetailView, post);
  const [draft, setDraft] = useState("");
  const [commit, { isInFlight }] = useMutation(addCommentMutation, AddCommentResult);

  const submit = async () => {
    if (!draft.trim()) return;
    const content = draft;
    setDraft("");
    await commit({
      input: { postId: data.id, content },
      optimistic: {
        content,
        createdAt: new Date().toISOString(),
        author: { __ref: "User:u1" },
      },
      optimisticTypename: "Comment",
      connections: [
        {
          parent: post,
          field: "comments",
          args: { sortBy: "newest" },
          where: "prepend",
          from: "newComment",
        },
      ],
    });
  };

  return (
    <article className="mx-auto max-w-2xl px-6 py-10">
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs uppercase tracking-wide text-zinc-600">
        {data.category}
      </span>
      <h1 className="mt-4 text-3xl font-bold text-zinc-900">{data.title}</h1>
      <div className="mt-4 flex items-center justify-between">
        {data.author ? <UserAvatar user={data.author} /> : null}
        <span className="text-xs text-zinc-500">♥ {data.likes}</span>
      </div>
      <p className="mt-6 leading-relaxed text-zinc-700">{data.content}</p>

      <h2 className="mt-10 text-lg font-semibold text-zinc-900">
        Comments ({data.comments.edges.length})
      </h2>
      <ul className="mt-3 space-y-2">
        {data.comments.edges.map(({ node }, i) => (
          <CommentRow key={i} comment={node} />
        ))}
      </ul>
      {hasNext ? (
        <button
          disabled={isLoadingNext}
          onClick={() => loadNext(5)}
          className="mt-4 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {isLoadingNext ? "Loading…" : "Load more comments"}
        </button>
      ) : (
        <p className="mt-4 text-xs text-zinc-400">No more comments.</p>
      )}

      <div className="mt-6 flex items-start gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment…"
          className="flex-1 rounded-md border border-zinc-300 bg-white p-2 text-sm"
          rows={2}
        />
        <button
          disabled={isInFlight || !draft.trim()}
          onClick={submit}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {isInFlight ? "Posting…" : "Post"}
        </button>
      </div>
    </article>
  );
}
