import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { errorResponse, readJson } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireSession();
    const [rows] = await getPool().execute(
      `SELECT ft.Trade_ID, ft.Account_ID, ft.From_Currency, ft.To_Currency, ft.Amount,
       ft.Trade_Type, ft.Status, ft.Open_Rate, ft.Close_Rate, ft.Profit_Loss, ft.Created_At
       FROM Forex_Trade ft JOIN Trading_Account ta ON ta.Account_ID = ft.Account_ID
       WHERE ta.Customer_ID = ? ORDER BY ft.Created_At DESC LIMIT 50`,
      [session.customerId],
    );
    return NextResponse.json({ trades: rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const input = await readJson(request);
  const accountId = Number(input?.accountId);
  const brokerId = Number(input?.brokerId);
  const amountText = typeof input?.amount === "string" || typeof input?.amount === "number"
    ? String(input.amount)
    : "";
  const amount = Number(amountText);
  const fromCurrency = typeof input?.fromCurrency === "string" ? input.fromCurrency.toUpperCase() : "";
  const toCurrency = typeof input?.toCurrency === "string" ? input.toCurrency.toUpperCase() : "";
  const tradeType = input?.tradeType;
  if (!Number.isInteger(accountId) || accountId <= 0 || !Number.isInteger(brokerId) || brokerId <= 0 ||
      !/^\d+(?:\.\d{1,2})?$/.test(amountText) ||
      !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000 ||
      !/^[A-Z]{3}$/.test(fromCurrency) || !/^[A-Z]{3}$/.test(toCurrency) ||
      (tradeType !== "BUY" && tradeType !== "SELL")) {
    return NextResponse.json({ error: "Trade details are invalid." }, { status: 400 });
  }

  try {
    const session = await requireSession();
    const [accounts] = await getPool().execute(
      "SELECT Account_ID FROM Trading_Account WHERE Account_ID = ? AND Customer_ID = ? AND Status = 'Active'",
      [accountId, session.customerId],
    );
    if ((accounts as unknown[]).length === 0) {
      return NextResponse.json({ error: "Active account not found." }, { status: 404 });
    }
    await getPool().query("CALL ExecuteTrade(?, ?, ?, ?, ?, ?)", [
      accountId, brokerId, fromCurrency, toCurrency, amountText, tradeType,
    ]);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && "sqlState" in error && error.sqlState === "45000") {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return errorResponse(error);
  }
}
