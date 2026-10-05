import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { ROLE_COOKIE, BRANCH_COOKIE, USER_COOKIE, type RoleId } from "@/lib/constants";

export interface Session {
  role: RoleId;
  branchId: string | null;
  userId: string | null;
}

const DEFAULT_ROLE: RoleId = "admin";

// Cookies persist for 30 days, but `npm run seed` regenerates every row's id.
// A stale branchId/userId from before a reseed must never be trusted as-is —
// silently querying with a dangling id just returns empty results, not an
// error, so every page down the line would look broken instead of blank.
export async function validateBranchId(branchId: string | null): Promise<string | null> {
  if (!branchId) return null;
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
  return branch ? branchId : null;
}

export async function validateUserId(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  return user ? userId : null;
}

export async function getSession(): Promise<Session> {
  const store = await cookies();
  const role = (store.get(ROLE_COOKIE)?.value as RoleId) || DEFAULT_ROLE;
  const [branchId, userId] = await Promise.all([
    validateBranchId(store.get(BRANCH_COOKIE)?.value || null),
    validateUserId(store.get(USER_COOKIE)?.value || null),
  ]);
  return { role, branchId, userId };
}

export async function getCurrentUser() {
  const { userId } = await getSession();
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId }, include: { branch: true } });
}
