import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";

// The role switcher's lists change only when someone edits branches or users, so they are kept for a minute
// instead of being read from the database on every page.
export const switcherLists = unstable_cache(
  async () => {
    const [branches, users] = await Promise.all([
      prisma.branch.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, branchId: true, role: true } }),
    ]);
    return { branches, users };
  },
  ["app-shell-switcher-lists"],
  { revalidate: 60 },
);
