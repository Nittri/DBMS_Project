import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireSession();
    const query = `SELECT Account_ID, Account_Type, Account_Status, Balance, Used_Margin,
      Free_Margin, Leverage, Total_Trades, Total_PnL
      FROM View_Customer_Trade_Summary WHERE Customer_ID = ? ORDER BY Account_ID`;
    const [rows] = await getPool().execute(query, [session.customerId]);
    return NextResponse.json({ accounts: rows });
  } catch (error) {
    return errorResponse(error);
  }
}
