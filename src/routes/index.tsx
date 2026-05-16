import { createFileRoute } from "@tanstack/react-router";
import { prefetch } from "@/frame";
import { Feed, FeedPageRequest } from "@/app/components/Feed";

export const Route = createFileRoute("/")({
  // Prime the cache with the initial "tech" feed before <Feed> mounts.
  // Changing the category later refetches in <Feed> via useRequest.
  loader: () => prefetch(FeedPageRequest, { category: "tech" }),
  component: Feed,
});
