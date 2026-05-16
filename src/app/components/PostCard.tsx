import { Link } from "@tanstack/react-router";
import { useView, view, type ViewKey } from "@/frame";
import { Post } from "@/server/schema/types";
import { UserAvatar, UserAvatarView } from "./UserAvatar";

export const PostCardView = view(
  Post,
  (p) => ({
    id: p.id,
    title: p.title,
    excerpt: p.excerpt,
    likes: p.likes,
    category: p.category,
    createdAt: p.createdAt,
    author: p.author.spread(UserAvatarView),
  }),
  { name: "PostCardView" },
);

export function PostCard({ post }: { post: ViewKey<typeof PostCardView> }) {
  const data = useView(PostCardView, post);

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs uppercase tracking-wide text-zinc-600">
          {data.category}
        </span>
        <span className="text-xs text-zinc-400">
          {new Date(data.createdAt).toLocaleDateString()}
        </span>
      </div>
      <Link
        to="/post/$id"
        params={{ id: data.id }}
        className="mt-3 block text-lg font-semibold text-zinc-900 hover:text-indigo-600"
      >
        {data.title}
      </Link>
      <p className="mt-2 text-sm text-zinc-600">{data.excerpt}</p>
      <div className="mt-4 flex items-center justify-between">
        {data.author ? <UserAvatar user={data.author} /> : null}
        <span className="text-xs text-zinc-500">♥ {data.likes}</span>
      </div>
    </article>
  );
}
