import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireSession();
    const [rows] = await getPool().execute(
      `SELECT ma.Margin_ID, ma.Account_ID, ma.Leverage, ma.Used_Margin, ma.Free_Margin,
       ma.Margin_Level, ta.Balance, ta.Status AS Account_Status
       FROM Margin_Account ma JOIN Trading_Account ta ON ta.Account_ID = ma.Account_ID
       WHERE ta.Customer_ID = ? ORDER BY ma.Account_ID`,
      [session.customerId],
    );
    const [transactions] = await getPool().execute(
      `SELECT mt.Transaction_ID, ma.Account_ID, mt.Amount, mt.Type, mt.Created_At
       FROM Margin_Transaction mt JOIN Margin_Account ma ON ma.Margin_ID = mt.Margin_ID
       JOIN Trading_Account ta ON ta.Account_ID = ma.Account_ID
       WHERE ta.Customer_ID = ? ORDER BY mt.Created_At DESC LIMIT 50`,
      [session.customerId],
    );
    return NextResponse.json({ margins: rows, transactions });
  } catch (error) {
    return errorResponse(error);
  }
}
