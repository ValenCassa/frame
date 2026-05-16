import { useView, view, type ViewKey } from "@/frame";
import { User } from "@/server/schema/types";

export const UserAvatarView = view(
  User,
  (u) => ({
    id: u.id,
    name: u.name,
    avatarUrl: u.avatarUrl,
  }),
  { name: "UserAvatarView" },
);

export function UserAvatar({ user }: { user: ViewKey<typeof UserAvatarView> }) {
  const data = useView(UserAvatarView, user);
  return (
    <div className="flex items-center gap-2">
      <img
        src={data.avatarUrl}
        alt={data.name}
        className="h-8 w-8 rounded-full border border-zinc-300"
      />
      <span className="text-sm font-medium text-zinc-700">{data.name}</span>
    </div>
  );
}
