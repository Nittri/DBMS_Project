import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { errorResponse, readJson } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId: rawPaymentId } = await params;
  const paymentId = Number(rawPaymentId);
  const input = await readJson(request);
  const action = input?.action;
  const note = typeof input?.note === "string" ? input.note.trim() : "";
  if (!Number.isInteger(paymentId) || paymentId <= 0 ||
      (action !== "APPROVE" && action !== "REJECT") || note.length > 255) {
    return NextResponse.json({ error: "Payment review details are invalid." }, { status: 400 });
  }
  try {
    const admin = await requireAdmin();
    await getPool().query("CALL ReviewWithdrawal(?, ?, ?, ?)", [paymentId, admin.userId, action, note || null]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && "sqlState" in error && error.sqlState === "45000") {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return errorResponse(error);
  }
}
