import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

// Shared, tamper-evident audit service used by every module. Each entry stores a
// checksum that chains it to the previous entry; `verifyAuditChain` re-computes
// the chain, so a changed, removed or inserted record is detected.

export interface AuditSnapshot {
  before?: unknown;
  after?: unknown;
}

interface AuditOptions {
  userId?: string | null;
  branchId?: string | null;
  source?: "web" | "sfa";
}

function computeHash(prevHash: string, e: {
  entity: string; entityId: string; action: string; userId: string; summary: string;
  beforeData: string | null; afterData: string | null; createdAt: Date;
}) {
  return createHash("sha256")
    .update([prevHash, e.entity, e.entityId, e.action, e.userId, e.summary, e.beforeData ?? "", e.afterData ?? "", e.createdAt.toISOString()].join("|"))
    .digest("hex");
}

export async function logAudit(
  entity: string,
  entityId: string,
  action: string,
  summary: string,
  snapshot?: AuditSnapshot,
  options: AuditOptions = {},
) {
  const session = await getSession();
  const userId = options.userId ?? session.userId;
  if (!userId) return;
  const branchId = options.branchId ?? session.branchId ?? null;
  const beforeData = snapshot?.before !== undefined ? JSON.stringify(snapshot.before) : null;
  const afterData = snapshot?.after !== undefined ? JSON.stringify(snapshot.after) : null;
  const createdAt = new Date();

  // The advisory lock serialises writers so two concurrent entries can never fork the chain.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(727001)`;
    const last = await tx.auditLog.findFirst({ where: { hash: { not: null } }, orderBy: { seq: "desc" }, select: { hash: true } });
    const prevHash = last?.hash ?? "";
    const hash = computeHash(prevHash, { entity, entityId, action, userId, summary, beforeData, afterData, createdAt });
    await tx.auditLog.create({
      data: {
        entity, entityId, action, userId, summary,
        beforeData, afterData, createdAt,
        branchId, role: session.role, source: options.source ?? "web",
        prevHash, hash,
      },
    });
  });
}

export interface ChainResult {
  checked: number;
  legacy: number;
  ok: boolean;
  problems: { seq: number; problem: string }[];
}

export async function verifyAuditChain(): Promise<ChainResult> {
  const [entries, legacy] = await Promise.all([
    prisma.auditLog.findMany({ where: { hash: { not: null } }, orderBy: { seq: "asc" } }),
    prisma.auditLog.count({ where: { hash: null } }),
  ]);
  const problems: ChainResult["problems"] = [];
  let prev = "";
  let prevSeq: number | null = null;
  for (const e of entries) {
    if (prevSeq !== null && e.seq !== prevSeq + 1) {
      problems.push({ seq: e.seq, problem: `Gap in sequence: entries ${prevSeq + 1}–${e.seq - 1} are missing` });
    }
    if ((e.prevHash ?? "") !== prev) problems.push({ seq: e.seq, problem: "Chain link broken: previous checksum does not match" });
    const expected = computeHash(e.prevHash ?? "", {
      entity: e.entity, entityId: e.entityId, action: e.action, userId: e.userId, summary: e.summary,
      beforeData: e.beforeData, afterData: e.afterData, createdAt: e.createdAt,
    });
    if (expected !== e.hash) problems.push({ seq: e.seq, problem: "Entry content has been altered (checksum mismatch)" });
    prev = e.hash ?? "";
    prevSeq = e.seq;
  }
  return { checked: entries.length, legacy, ok: problems.length === 0, problems };
}
