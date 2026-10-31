import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { errorResponse, readJson } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireSession();
    const [rows] = await getPool().execute(
      `SELECT p.Payment_ID, p.Account_ID, p.Amount, p.Type, p.Status, p.Payment_Date,
       p.Reviewed_At, p.Review_Note
       FROM Payment p JOIN Trading_Account ta ON ta.Account_ID = p.Account_ID
       WHERE ta.Customer_ID = ? ORDER BY p.Payment_Date DESC LIMIT 50`,
      [session.customerId],
    );
    return NextResponse.json({ payments: rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const input = await readJson(request);
  const accountId = Number(input?.accountId);
  const amountText = typeof input?.amount === "string" || typeof input?.amount === "number"
    ? String(input.amount)
    : "";
  const amount = Number(amountText);
  if (!Number.isInteger(accountId) || accountId <= 0 ||
      !/^\d+(?:\.\d{1,2})?$/.test(amountText) || !Number.isFinite(amount) ||
      amount <= 0 || amount > 1_000_000) {
    return NextResponse.json({ error: "Withdrawal details are invalid." }, { status: 400 });
  }

  try {
    const session = await requireSession();
    const pool = getPool();
    const [accounts] = await pool.execute(
      "SELECT Account_ID FROM Trading_Account WHERE Account_ID = ? AND Customer_ID = ? AND Status = 'Active'",
      [accountId, session.customerId],
    );
    if ((accounts as unknown[]).length === 0) {
      return NextResponse.json({ error: "Active account not found." }, { status: 404 });
    }
    const [brokers] = await pool.query("SELECT Broker_ID FROM Broker ORDER BY Broker_ID LIMIT 1");
    const broker = (brokers as Array<{ Broker_ID: number }>)[0];
    if (!broker) return NextResponse.json({ error: "No broker is configured." }, { status: 503 });
    await pool.query("CALL RequestWithdrawal(?, ?, ?)", [accountId, broker.Broker_ID, amountText]);
    return NextResponse.json({ ok: true, status: "PENDING" }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && "sqlState" in error && error.sqlState === "45000") {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return errorResponse(error);
  }
}
