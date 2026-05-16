export interface UserRow {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
}

export interface CommentRow {
  id: string;
  content: string;
  createdAt: string;
  authorId: string;
  postId: string;
}

export interface PostRow {
  id: string;
  title: string;
  excerpt: string;
  content: string;
  likes: number;
  category: string;
  createdAt: string;
  authorId: string;
}

export const users: UserRow[] = [
  {
    id: "u1",
    name: "Ada Lovelace",
    email: "ada@frame.dev",
    avatarUrl: "https://i.pravatar.cc/64?img=47",
  },
  {
    id: "u2",
    name: "Grace Hopper",
    email: "grace@frame.dev",
    avatarUrl: "https://i.pravatar.cc/64?img=48",
  },
  {
    id: "u3",
    name: "Linus Torvalds",
    email: "linus@frame.dev",
    avatarUrl: "https://i.pravatar.cc/64?img=12",
  },
];

export const posts: PostRow[] = [
  {
    id: "p1",
    title: "Why frame ships fragments without GraphQL",
    excerpt: "Relay's ergonomics, none of the SDL.",
    content:
      "frame keeps the normalized cache, view spreading, pagination, and data masking, and drops the schema-language tax. Effect schemas are the source of truth.",
    likes: 42,
    category: "tech",
    createdAt: "2026-05-12T09:14:00Z",
    authorId: "u1",
  },
  {
    id: "p2",
    title: "Connection identity, cursors stripped",
    excerpt: "Relay's connection rules, in TypeScript.",
    content:
      "Pagination args don't enter the cache key. Filter args do. That's how loadNext keeps appending to the same connection instead of forking it.",
    likes: 17,
    category: "tech",
    createdAt: "2026-05-13T16:02:00Z",
    authorId: "u2",
  },
  {
    id: "p3",
    title: "Garden notes — May",
    excerpt: "Tomatoes, basil, ergonomics.",
    content: "Off-topic, but the tomatoes are doing well this season. Filed under 'life'.",
    likes: 5,
    category: "life",
    createdAt: "2026-05-15T07:30:00Z",
    authorId: "u3",
  },
];

export const comments: CommentRow[] = Array.from({ length: 12 }, (_, i) => ({
  id: `c${i + 1}`,
  content: `Comment #${i + 1} — frame is interesting.`,
  createdAt: new Date(2026, 4, 1 + i, 10, 0, 0).toISOString(),
  authorId: ["u1", "u2", "u3"][i % 3]!,
  postId: i < 7 ? "p1" : "p2",
}));

export const findUser = (id: string) => users.find((u) => u.id === id);
export const findPost = (id: string) => posts.find((p) => p.id === id);
export const commentsForPost = (postId: string) => comments.filter((c) => c.postId === postId);
