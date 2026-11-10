import { NextResponse } from "next/server";
import { requireBrokerOrAdmin } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireBrokerOrAdmin();
    const brokerScope = session.role === "BROKER" ? "AND p.Broker_ID = ?" : "";
    const parameters = session.role === "BROKER" ? [session.brokerId] : [];
    const [rows] = await getPool().query(
      `SELECT p.Payment_ID, p.Account_ID, c.Name AS Customer_Name, p.Amount,
       p.Status, p.Payment_Date
       FROM Payment p
       JOIN Trading_Account ta ON ta.Account_ID = p.Account_ID
       JOIN Customer c ON c.Customer_ID = ta.Customer_ID
       WHERE p.Type = 'WITHDRAWAL' AND p.Status = 'PENDING'
       ${brokerScope}
       ORDER BY p.Payment_Date ASC`,
      parameters,
    );
    return NextResponse.json({ payments: rows });
  } catch (error) {
    return errorResponse(error);
  }
}
