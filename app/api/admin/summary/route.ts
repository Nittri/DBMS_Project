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
        (SELECT COUNT(*) FROM Payment) AS payments`,
    );
    return NextResponse.json({ summary: (rows as unknown[])[0] });
  } catch (error) {
    return errorResponse(error);
  }
}
