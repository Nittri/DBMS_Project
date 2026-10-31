import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    const [rows] = await getPool().query(
      `SELECT p.Payment_ID, p.Account_ID, c.Name AS Customer_Name, p.Amount,
       p.Status, p.Payment_Date
       FROM Payment p
       JOIN Trading_Account ta ON ta.Account_ID = p.Account_ID
       JOIN Customer c ON c.Customer_ID = ta.Customer_ID
       WHERE p.Type = 'WITHDRAWAL' AND p.Status = 'PENDING'
       ORDER BY p.Payment_Date ASC`,
    );
    return NextResponse.json({ payments: rows });
  } catch (error) {
    return errorResponse(error);
  }
}
