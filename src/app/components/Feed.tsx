import { useState, useTransition } from "react";
import { Schema } from "effect";
import { pick, request, useRequest } from "@/frame";
import { feedQuery } from "@/server/schema/queries";
import { PostCard, PostCardView } from "./PostCard";

export const FeedPageRequest = request("FeedPage", {
  args: Schema.Struct({ category: Schema.String }),
  select: (args) => ({
    posts: pick(feedQuery, { category: args.category }, PostCardView),
  }),
});

export function Feed() {
  const [category, setCategory] = useState<"tech" | "life">("tech");
  const [isPending, startTransition] = useTransition();
  const { data, refetch } = useRequest(FeedPageRequest, { category });

  return (
    <section className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-zinc-900">frame</h1>
        <div className="flex gap-2">
          {(["tech", "life"] as const).map((c) => (
            <button
              key={c}
              onClick={() => startTransition(() => setCategory(c))}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                category === c
                  ? "bg-indigo-600 text-white"
                  : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              {c}
            </button>
          ))}
          <button
            onClick={() => refetch()}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            ⟳
          </button>
        </div>
      </div>
      <p className="mt-2 text-sm text-zinc-500">
        A demo of frame — Relay-style views without GraphQL.
      </p>
      <div className={`mt-8 grid gap-4 transition-opacity ${isPending ? "opacity-50" : ""}`}>
        {data.posts.map((post, i) => (
          <PostCard key={i} post={post} />
        ))}
      </div>
    </section>
  );
}
