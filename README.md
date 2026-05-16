# frame

This is me playing around. No claim that it's production ready, no claim that it's even a good idea. I'm building it because it's fun.

## Why

I don't think anyone has gotten data fetching right. Most of what we have is fine, none of it is great. Relay is the closest thing to perfection I've seen: the normalized cache, the fragment masking, the connection model, the way views co-locate with components and refetch in isolation. It's a different category from everything else.

But Relay drags GraphQL with it. The schema language, the compiler, the codegen pipeline, the directives, the persisted queries, the runtime that has to understand all of it. Every project that picks Relay is also picking a server stack, a build step, and a set of opinions that bleed into every layer. For a lot of apps that's too much.

I wanted something with the **DX of Relay** (the views, the masking, the typed store, the connection ergonomics, the refetchable slices, the typed mutations with optimistic updates) but **without GraphQL**. No SDL. No compiler. No codegen toolchain you have to keep in sync. Just TypeScript, Effect Schema, a Vite plugin that generates resolver skeletons on dev start, and a normalized client cache that does the work.

That's frame.

---

## Quick start

```bash
pnpm install
pnpm dev
```

On first start, the frame Vite plugin:
1. Scans your schema files for types, queries, and mutations.
2. Creates `src/routes/api/frame.ts` (the HTTP endpoint) if it doesn't exist.
3. Generates resolver skeletons in `src/server/resolvers/` (one file per type, one per query, one per mutation).
4. Generates a barrel `src/server/resolvers/index.gen.ts` that wires them together.

You fill in the resolver bodies. TypeScript tells you which fields you must implement.

---

## Core concepts

### 1. Schema

Plain TypeScript. Effect Schema for scalars, declarators for relationships.

```ts
// src/server/schema/types.ts
import { Schema } from "effect";
import { type, scalar, ref, connection } from "@frame/react";

export const User = type("User", {
  id: scalar(Schema.String),
  name: scalar(Schema.String),
  avatarUrl: scalar(Schema.String),
});

export const Post = type("Post", {
  id: scalar(Schema.String),
  title: scalar(Schema.String),
  likes: scalar(Schema.Number),
  author: ref(() => User),                  // single linked entity
  comments: connection(() => Comment, {     // paginated, typed args
    args: Schema.Struct({ sortBy: Schema.Literal("newest", "oldest") }),
  }),
});
```

Four declarators:

- `scalar(schema)`: a primitive field. Type comes from the Effect Schema.
- `ref(() => T)`: a single linked entity.
- `list(() => T)`: a plain (non paginated) list of entities.
- `connection(() => T, { args })`: a paginated list. Always requires a resolver, never readable as a plain list.

Queries:

```ts
// src/server/schema/queries.ts
import { Schema } from "effect";
import { query } from "@frame/react";
import { Post } from "./types";

export const postQuery = query("post", {
  input: Schema.Struct({ id: Schema.String }),
  returns: Post,
});

export const feedQuery = query("feed", {
  input: Schema.Struct({ category: Schema.String }),
  returns: Post,
  list: true,             // returns Post[] rather than a single Post
});
```

Mutations look the same but return either a regular type or a transient payload (see Section 7).

```ts
// src/server/schema/mutations.ts
import { Schema } from "effect";
import { mutation } from "@frame/react";
import { AddCommentPayload } from "./types";

export const addCommentMutation = mutation("addComment", {
  input: Schema.Struct({ postId: Schema.String, content: Schema.String }),
  returns: AddCommentPayload,
});
```

### 2. Resolvers

On first dev start, the plugin writes typed skeletons. You fill in the body.

```ts
// src/server/resolvers/Query/post.ts
export const post = defineQuery(postQuery, ({ input }) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* db.posts.byId(input.id);  // input.id: string
  }),
);
```

```ts
// src/server/resolvers/Post.ts (one file per type)
export const Post = defineType(PostType)({
  comments: ({ parent, args, after, first }) =>
    Effect.gen(function* () {
      // parent: typed from the schema (title, likes, ...)
      // args:   { sortBy: "newest" | "oldest" }
      // after:  string | null
      // first:  number
      const db = yield* Db;
      return yield* db.comments.page(parent.id, args.sortBy, after, first);
      // return shape: { edges, pageInfo }
    }),
});
```

Two rules:

- **Connections and fields with args always require a resolver.** A default resolver can't produce a paginated shape or apply arguments.
- **Everything else has a default**: read `parent[field]`. If your upstream resolver returned the field, the default just works. Override by defining a resolver explicitly.

So if `Post.title` is just `parent.title`, you don't need to write anything. If you want to override (a computed title, an enrichment, a translation), define it:

```ts
export const Post = defineType(PostType)({
  // Override a scalar with a computed value.
  title: ({ parent }) =>
    Effect.gen(function* () {
      return `[${parent.category}] ${parent.title}`;
    }),

  // Override a ref by fetching from a different source.
  author: ({ parent }) =>
    Effect.gen(function* () {
      const users = yield* UsersService;
      return yield* users.byId(parent.authorId);
    }),

  comments: ({ parent, args, after, first }) => /* ... */,
});
```

The dispatch is **resolver first, parent fallback**: if a resolver is defined, it always runs. Otherwise frame reads `parent[field]`.

### 3. Source types (typing `parent`)

By default `parent` is the schema derived shape: scalars typed from their Effect Schema, refs and lists optional, connections excluded. That's good enough for the common case where your upstream resolver returns roughly the schema shape.

When your upstream returns something more specific (a DB row with foreign keys, an API DTO with extra columns), declare a source:

```ts
type PostSource = {
  id: string;
  title: string;
  excerpt: string;
  content: string;
  likes: number;
  category: string;
  createdAt: string;
  authorId: string;        // FK, not a nested User
};

export const Post = type("Post", {
  /* schema fields, including author: ref(() => User) */
}).source<PostSource>();
```

Two things change in `defineType(PostType)({...})`:

```ts
export const Post = defineType(PostType)({
  // parent is now PostSource & { __typename: "Post" }
  // parent.authorId autocompletes as string
  // parent.foo (not in PostSource) is a TS error

  // author is REQUIRED now (PostSource has authorId, not author)
  author: ({ parent }) =>
    Effect.gen(function* () {
      const users = yield* UsersService;
      return yield* users.byId(parent.authorId);
    }),

  // comments is REQUIRED (connections always are)
  comments: ({ parent, args, after, first }) => /* ... */,

  // title, excerpt, likes, etc. stay OPTIONAL (PostSource covers them)
});
```

The rule for "is this resolver required?":

1. Connection → required.
2. Field has args → required.
3. Source declared and field name not in `keyof Source` → required.
4. Otherwise → optional.

Skip `.source<T>()` and frame uses the schema derived default. Add it to tighten typing and surface forgotten resolvers at compile time.

### 4. Views

Views are the client side of the schema. They're fragments: a typed declaration of the fields a component needs.

```ts
const UserCard = view(User, (u) => ({
  name: u.name,
  avatarUrl: u.avatarUrl,
}));

const PostPage = view(Post, (p) => ({
  title: p.title,
  likes: p.likes,
  author: p.author.spread(UserCard),
}));
```

Two composition primitives:

**`field.spread(View | builder)`** selects fields inside a nested ref, list, or connection. The child view must be on the field's target type.

```ts
// Named view, reusable across parents:
author: p.author.spread(UserCard),

// Inline builder, when the selection is local to one parent:
author: p.author.spread((u) => ({ name: u.name, avatarUrl: u.avatarUrl })),
```

**`...p.include(View)`** inlines a sibling view's selection at the same level. The child view must be on the same type as the parent. Used to fold a child component's view into the parent's request so the whole page loads in one network roundtrip.

```ts
const PostPage = view(Post, (p) => ({
  title: p.title,
  likes: p.likes,
  ...p.include(PostCommentsView),   // adds whatever PostCommentsView declares
}));
```

Connections need their own builder method:

```ts
view(Post, (p) => ({
  comments: p.comments({ sortBy: "newest" }).connection(
    (c) => ({ id: c.id, content: c.content, author: c.author.spread(UserCard) }),
    { first: 10 },
  ),
}));
```

`p.comments({ sortBy: "newest" })` applies the args, `.connection(builder, opts)` selects the inner shape and the page size.

### 5. Reading data

A `request` pairs an input with a selection over your queries.

```ts
const PostRequest = request(
  Schema.Struct({ postId: Schema.String }),
  (input, q) => ({ post: q.post({ id: input.postId }).spread(PostPage) }),
);
```

Reading in a component:

```tsx
function PostScreen({ postId }: { postId: string }) {
  const { data, isStale, refetch } = useRequest(PostRequest, { postId });
  // data.post: ViewKey<typeof PostPage>

  const p = useView(PostPage, data.post);
  // p: Data<typeof PostPage> (fully typed mask)

  return (
    <>
      <h1>{p.title} ({p.likes} ♥)</h1>
      <img src={p.author.avatarUrl} alt={p.author.name} />
      <Comments post={data.post} />   {/* pass the masked key down */}
    </>
  );
}
```

A refetchable view declares its own slice of the data and can re-fetch it in isolation. `usePaginationView` does this for connections; `useRefetchableView` does it for anything else (re-run with new variables).

```tsx
// Co-located with the Comments component.
export const PostCommentsView = view(Post, (p) => ({
  comments: p.comments({ sortBy: "newest" }).connection(
    (c) => ({ id: c.id, content: c.content, author: c.author.spread(UserCard) }),
    { first: 10 },
  ),
}), { refetchable: true });

function Comments({ post }: { post: ViewKey<typeof PostCommentsView> }) {
  const { data, loadNext, hasNext, isLoadingNext } =
    usePaginationView(PostCommentsView, post);

  return (
    <>
      {data.comments.edges.map(({ node }) => (
        <li key={node.id}>{node.content} by {node.author.name}</li>
      ))}
      {hasNext && <button onClick={() => loadNext(10)}>Load more</button>}
    </>
  );
}
```

Example of `useRefetchableView` (no pagination, just re-run with different variables):

```ts
const ProfileView = view(User, (u) => ({
  name: u.name,
  email: u.email,
}), { refetchable: true });

const ProfileRequest = request(
  Schema.Struct({ userId: Schema.String }),
  (input, q) => ({ user: q.user({ id: input.userId }).spread(ProfileView) }),
);

function Profile({ user }: { user: ViewKey<typeof ProfileView> }) {
  const { data, refetch } = useRefetchableView(ProfileView, ProfileRequest, user);
  return (
    <>
      <h2>{data.name}</h2>
      <button onClick={() => refetch({ userId: "another" })}>Switch user</button>
    </>
  );
}
```

The hooks are constrained at the type level:

- `useRefetchableView` requires a view declared with `{ refetchable: true }`. Pass a regular view → compile error.
- `usePaginationView` additionally requires the view's selection to contain a connection. Pass a refetchable view with no connection → compile error.

Same guarantee Relay gets from its compiler, via TypeScript inference instead of codegen.

### 6. Mutations

Most mutations just return the updated entity. Frame normalizes it by id and every view watching that entity re-renders. No updater, no invalidation.

Schema:

```ts
// src/server/schema/mutations.ts
export const likePostMutation = mutation("likePost", {
  input: Schema.Struct({ postId: Schema.String }),
  returns: Post,    // returns the Post directly
});
```

Server:

```ts
// src/server/resolvers/Mutation/likePost.ts
export const likePost = defineMutation(likePostMutation, ({ input }) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* db.posts.like(input.postId);   // returns the updated Post row
  }),
);
```

Client:

```tsx
const [likePost] = useMutation(likePostMutation);

likePost({ input: { postId } });
// Server returns the updated Post.
// Frame writes it into the cache at `Post:${postId}`.
// Every useView/useRequest reading that Post re-renders with the new likes count.
```

That's the whole loop. No `refetchQueries`, no `update` callback, no `invalidateQueries`. The cache is keyed by `__typename:id`; any record returned anywhere ends up in the right place.

When you need more (instant feedback, or inserting into a connection that the server doesn't know you have cached):

```tsx
const [addComment] = useMutation(addCommentMutation);

addComment({
  input: { postId, content },

  // Optional: runs immediately, reverts if the mutation fails.
  optimistic: (store) => {
    const post = store.get(Post, postId);
    post?.setValue("likes", (post.getValue("likes") ?? 0) + 1);
  },

  // Optional: connection inserts can't be inferred from a returned entity
  // alone (the server doesn't know which sortBy pages you have cached), so
  // wire that here. Scalar/ref updates don't need an updater.
  updater: (store, payload) => {
    const post = store.get(Post, postId);
    const conn = post?.getConnection("comments", { sortBy: "newest" });
    conn?.insert(payload.comment, { at: "start" });
  },
});
```

### 7. Transient payload types

Some mutations need to return more than a single entity. The classic case is "I added a comment, but also bumped the post's commentCount and updated the user's last activity timestamp." You want all of that to flow back so the cache stays consistent, but the shape itself isn't an entity you'd ever fetch directly.

That's a transient payload. Declared with `payload()` instead of `type()`. The payload itself isn't normalized into the cache, but every entity inside it is.

```ts
// src/server/schema/types.ts
import { payload, ref } from "@frame/react";

export const AddCommentPayload = payload("AddCommentPayload", {
  comment: ref(() => Comment),
  post: ref(() => Post),       // updated post (e.g. new commentCount)
});
```

```ts
// src/server/schema/mutations.ts
export const addCommentMutation = mutation("addComment", {
  input: Schema.Struct({ postId: Schema.String, content: Schema.String }),
  returns: AddCommentPayload,
});
```

```ts
// src/server/resolvers/Mutation/addComment.ts
export const addComment = defineMutation(addCommentMutation, ({ input }) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const comment = yield* db.comments.create(input.postId, input.content);
    const post = yield* db.posts.byId(input.postId);
    return { comment, post };
    // Frame normalizes `comment` into Comment:<id> and `post` into Post:<id>.
    // The payload wrapper itself is discarded after normalization.
  }),
);
```

The result on the client:

```tsx
addComment({
  input: { postId, content },
  updater: (store, payload) => {
    // payload.comment: Comment from the response
    // payload.post:    Post from the response (already in cache via normalization)
    const post = store.get(Post, payload.post.id);
    post?.getConnection("comments", { sortBy: "newest" })?.insert(payload.comment, { at: "start" });
  },
});
```

Use a regular `type()` when the mutation returns a single entity you'd also fetch elsewhere. Use `payload()` when the return is a structural wrapper holding multiple updated entities.

### 8. Imperative store edits

When you want to write to the cache outside of a mutation (e.g. on a WebSocket event, on form change, on a route transition), use `commitLocalUpdate`:

```ts
import { commitLocalUpdate, useFrameClient } from "@frame/react";

function MarkRead({ postId }: { postId: string }) {
  const client = useFrameClient();
  return (
    <button onClick={() => {
      commitLocalUpdate(client, (store) => {
        const post = store.get(Post, postId);
        post?.setValue("isRead", true);
      });
    }}>Mark read</button>
  );
}
```

Or read the store directly inside a component with `useStore`:

```ts
const store = useStore();
const post = store.get(Post, postId);
```

The store proxies are typed: `RecordProxy<Post>` knows what fields `Post` has and what kinds they are. `getValue("title")` returns `string`. `getLink("author")` returns a typed `RecordProxy<User>`. `getConnection("comments", { sortBy: "newest" })` returns a `ConnectionProxy<Comment>` with `insert`, `remove`, `replace`, etc.

### 9. Fetch policies and staleness

Each `useRequest` accepts:

```tsx
useRequest(PostRequest, { postId }, {
  fetchPolicy: "cache-and-network",   // default; also: cache-first, network-only, cache-only
  staleTime: 30_000,                  // ms; default 0
  refetchInterval: 5_000,             // ms; off by default
});
```

Programmatic equivalents (no hook, use anywhere):

```ts
import { prefetch, fetchRequest, commitMutation } from "@frame/react";

await prefetch(client, PostRequest, { postId: "p1" });            // warm cache
const data = await fetchRequest(client, PostRequest, { postId }); // typed result
await commitMutation(client, likePostMutation, { input: { postId } });
```

---

## How it works under the hood

- **Schema discovery.** The Vite plugin uses `runnerImport` to load your schema files in dev. It collects everything exported that looks like a frame type, query, or mutation.
- **Code generation.** Resolver skeletons are written once (`writeIfMissing`). The barrel `index.gen.ts` is regenerated every dev start. The API route at `src/routes/api/frame.ts` is created once and you own it after that.
- **Wire protocol.** Views compile to a flat selection tree on the wire (`compileView`). The handler walks it, normalizes results into a record map keyed by `__typename:id`, and returns refs.
- **Normalized cache.** `FrameCache` holds records, request roots, and per root staleness metadata. Mutations and pagination updates write back to the same map; subscribers are notified via `useSyncExternalStore`.
- **View masking.** A `ViewKey<V>` is an opaque branded type. The reader (`unmask`) takes a key and a view, walks the view's selection, reads from the cache, and returns the typed `Data<V>` shape.

---

## Status

Playground. The shape of the API is what I'm exploring. Internals will change without warning. If you want to poke around, start with:

- `src/frame/core/type.ts`: schema declarators and `.source<T>()`.
- `src/frame/core/view.ts`: views, builders, and selection nodes.
- `src/frame/core/request.ts`: request builders.
- `src/frame/client/hooks.ts`: `useRequest`, `useView`, `useRefetchableView`, `usePaginationView`, `useMutation`, `useStore`.
- `src/frame/client/cache.ts`: normalized cache and connection helpers.
- `src/frame/client/store-proxy.ts`: typed `StoreProxy`/`RecordProxy`/`ConnectionProxy`.
- `src/frame/server/resolver.ts`: `defineType`, `defineQuery`, `defineMutation`, source inference.
- `src/frame/server/handler.ts`: request execution and normalization.
- `src/frame/vite-plugin.ts`: the dev time scaffolder.
- `src/server/schema/` and `src/server/resolvers/`: the demo app.
