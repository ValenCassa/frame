import { useView, view, type ViewKey } from "@/frame";
import { Comment } from "@/server/schema/types";
import { UserAvatar, UserAvatarView } from "./UserAvatar";

export const CommentView = view(
  Comment,
  (c) => ({
    id: c.id,
    content: c.content,
    createdAt: c.createdAt,
    author: c.author.spread(UserAvatarView),
  }),
  { name: "CommentView" },
);

export function CommentRow({ comment }: { comment: ViewKey<typeof CommentView> }) {
  const data = useView(CommentView, comment);
  return (
    <li className="rounded-md border border-zinc-200 bg-white p-3">
      {data.author ? <UserAvatar user={data.author} /> : null}
      <p className="mt-2 text-sm text-zinc-700">{data.content}</p>
      <span className="mt-2 block text-xs text-zinc-400">
        {new Date(data.createdAt).toLocaleString()}
      </span>
    </li>
  );
}
