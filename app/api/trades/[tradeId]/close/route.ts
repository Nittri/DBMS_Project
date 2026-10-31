import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ tradeId: string }> },
) {
  const { tradeId: rawTradeId } = await params;
  const tradeId = Number(rawTradeId);
  if (!Number.isInteger(tradeId) || tradeId <= 0) {
    return NextResponse.json({ error: "Trade ID is invalid." }, { status: 400 });
  }

  try {
    const session = await requireSession();
    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT ft.Account_ID FROM Forex_Trade ft
       JOIN Trading_Account ta ON ta.Account_ID = ft.Account_ID
       WHERE ft.Trade_ID = ? AND ta.Customer_ID = ? AND ft.Status = 'OPEN'`,
      [tradeId, session.customerId],
    );
    if ((rows as unknown[]).length === 0) {
      return NextResponse.json({ error: "Open trade not found." }, { status: 404 });
    }
    const accountId = (rows as Array<{ Account_ID: number }>)[0].Account_ID;
    await pool.query("CALL CloseTrade(?, ?)", [tradeId, accountId]);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && "sqlState" in error && error.sqlState === "45000") {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return errorResponse(error);
  }
}
