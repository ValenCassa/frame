import { Schema } from "effect";
import { createFileRoute, Link } from "@tanstack/react-router";
import { pick, prefetch, request, useRequest } from "@/frame";
import { postByIdQuery } from "@/server/schema/queries";
import { PostDetail, PostDetailView } from "@/app/components/PostDetail";

const PostPageRequest = request("PostPage", {
  args: Schema.Struct({ id: Schema.String }),
  select: (args) => ({
    post: pick(postByIdQuery, { id: args.id }, PostDetailView),
  }),
});

export const Route = createFileRoute("/post/$id")({
  // Loader runs before render — primes the cache so <PostPage> renders sync.
  loader: ({ params }) => prefetch(PostPageRequest, { id: params.id }),
  component: PostPage,
});

function PostPage() {
  const { id } = Route.useParams();
  const { data } = useRequest(PostPageRequest, { id });

  return (
    <div>
      <div className="mx-auto max-w-2xl px-6 pt-6">
        <Link to="/" className="text-sm text-indigo-600 hover:underline">
          ← Back to feed
        </Link>
      </div>
      {data.post ? <PostDetail post={data.post} /> : <p className="p-8">Not found.</p>}
    </div>
  );
}
