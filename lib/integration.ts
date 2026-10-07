import { prisma } from "@/lib/prisma";

// Simulated API gateway: every exchange with a connected system is logged as a message. When
// an administrator switches on "simulate outage" the next N messages fail and wait in the
// error queue until corrected and resent — exactly how a real interface failure would behave.

export type Connector = "erp" | "sfa" | "trade_promotion" | "merchandising" | "bi" | "email";

export const CONNECTOR_LABEL: Record<Connector, string> = {
  erp: "ERP",
  sfa: "SFA application",
  trade_promotion: "Trade promotion application",
  merchandising: "Merchandising application",
  bi: "Business intelligence feed",
  email: "E-mail / report inbox",
};

export async function sendMessage(input: {
  connector: Connector;
  direction: "inbound" | "outbound";
  docType: string;
  reference: string;
  payload?: unknown;
}) {
  const failNow = await prisma.appSetting.findUnique({ where: { key: "integration.failNext" } });
  const remaining = Number(failNow?.value ?? 0);
  const fail = remaining > 0;
  if (fail) {
    await prisma.appSetting.update({ where: { key: "integration.failNext" }, data: { value: String(remaining - 1) } });
  }
  return prisma.integrationMessage.create({
    data: {
      connector: input.connector,
      direction: input.direction,
      docType: input.docType,
      reference: input.reference,
      status: fail ? "error" : "ok",
      error: fail ? "Gateway timeout — endpoint did not respond (simulated outage)" : null,
      payload: input.payload === undefined ? null : JSON.stringify(input.payload),
    },
  });
}
