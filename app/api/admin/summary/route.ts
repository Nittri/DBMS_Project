import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    const [rows] = await getPool().query(
      `SELECT
        (SELECT COUNT(*) FROM Customer) AS customers,
        (SELECT COUNT(*) FROM Trading_Account) AS accounts,
        (SELECT COUNT(*) FROM Forex_Trade) AS trades,
        (SELECT COUNT(*) FROM Payment) AS payments,
        (SELECT COUNT(*) FROM Forex_Trade WHERE Status = 'OPEN') AS open_trades,
        (SELECT COUNT(*) FROM Payment WHERE Type = 'WITHDRAWAL' AND Status = 'PENDING') AS pending_withdrawals,
        (SELECT COUNT(*) FROM Broker) AS brokers,
        (SELECT COALESCE(SUM(Commission_Rate), 0) FROM Broker) AS total_commission_rate`,
    );
    return NextResponse.json({ summary: (rows as unknown[])[0] });
  } catch (error) {
    return errorResponse(error);
  }
}
