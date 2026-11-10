import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireSession();
    if (session.role !== "BROKER" || session.brokerId === null) {
      return NextResponse.json({ error: "Broker access required." }, { status: 403 });
    }

    const [rows] = await getPool().execute(
      `SELECT b.Name AS Broker_Name,
        (SELECT COUNT(*) FROM Forex_Trade ft WHERE ft.Broker_ID = b.Broker_ID) AS Trades,
        (SELECT COUNT(*) FROM Forex_Trade ft WHERE ft.Broker_ID = b.Broker_ID AND ft.Status = 'OPEN') AS Open_Trades,
        (SELECT COUNT(*) FROM Payment p WHERE p.Broker_ID = b.Broker_ID) AS Payments,
        (SELECT COUNT(*) FROM Payment p WHERE p.Broker_ID = b.Broker_ID
          AND p.Type = 'WITHDRAWAL' AND p.Status = 'PENDING') AS Pending_Withdrawals,
        (SELECT COALESCE(SUM(ft.Amount), 0) FROM Forex_Trade ft
          WHERE ft.Broker_ID = b.Broker_ID) AS Traded_Notional
       FROM Broker b WHERE b.Broker_ID = ?`,
      [session.brokerId],
    );
    const summary = (rows as Array<{
      Broker_Name: string; Trades: number; Open_Trades: number; Payments: number;
      Pending_Withdrawals: number; Traded_Notional: number;
    }>)[0];
    if (!summary) return NextResponse.json({ error: "Broker account not found." }, { status: 404 });
    return NextResponse.json({
      summary: {
        brokerName: summary.Broker_Name,
        trades: summary.Trades,
        openTrades: summary.Open_Trades,
        payments: summary.Payments,
        pendingWithdrawals: summary.Pending_Withdrawals,
        tradedNotional: summary.Traded_Notional,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
