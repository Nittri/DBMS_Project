import { NextResponse } from "next/server";
import { requireAdmin, requireSession } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { getRateHistoryCollection } from "@/lib/mongo";
import { errorResponse, readJson } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireSession();
    const [rates] = await getPool().query(
      `SELECT er.From_Currency, er.To_Currency, er.Rate, er.Updated_At,
       (SELECT COUNT(*) FROM Forex_Trade ft
        WHERE ft.From_Currency = er.From_Currency AND ft.To_Currency = er.To_Currency) AS Trade_Count
       FROM Exchange_Rate er ORDER BY er.From_Currency, er.To_Currency`,
    );
    try {
      const historyCollection = await getRateHistoryCollection();
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const history = await historyCollection.aggregate<{
        pair: string; rate: number; recordedAt: Date;
      }>([
        { $match: { recordedAt: { $gte: since } } },
        { $sort: { recordedAt: 1 } },
        {
          $group: {
            _id: {
              pair: "$pair",
              day: { $dateToString: { format: "%Y-%m-%d", date: "$recordedAt" } },
            },
            rate: { $last: "$rate" },
            recordedAt: { $last: "$recordedAt" },
          },
        },
        { $sort: { "_id.pair": 1, "_id.day": 1 } },
        { $project: { _id: 0, pair: "$_id.pair", rate: 1, recordedAt: 1 } },
      ]).toArray();
      return NextResponse.json({ rates, history, historyAvailable: true });
    } catch (error) {
      console.error("Could not load MongoDB rate history:", error);
      return NextResponse.json({ rates, history: [], historyAvailable: false });
    }
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  const input = await readJson(request);
  const fromCurrency = typeof input?.fromCurrency === "string" ? input.fromCurrency.toUpperCase() : "";
  const toCurrency = typeof input?.toCurrency === "string" ? input.toCurrency.toUpperCase() : "";
  const rateText = typeof input?.rate === "string" || typeof input?.rate === "number"
    ? String(input.rate)
    : "";
  const rate = Number(rateText);
  if (!/^[A-Z]{3}$/.test(fromCurrency) || !/^[A-Z]{3}$/.test(toCurrency) ||
      fromCurrency === toCurrency || !/^\d+(?:\.\d{1,6})?$/.test(rateText) ||
      !Number.isFinite(rate) || rate <= 0 || rate > 1_000_000) {
    return NextResponse.json({ error: "Exchange rate details are invalid." }, { status: 400 });
  }

  try {
    const admin = await requireAdmin();
    const pool = getPool();
    const [currencies] = await pool.execute(
      "SELECT Currency_Code FROM Currency WHERE Currency_Code IN (?, ?)",
      [fromCurrency, toCurrency],
    );
    if ((currencies as unknown[]).length !== 2) {
      return NextResponse.json({ error: "Both currencies must exist in the Currency table." }, { status: 422 });
    }
    const [previousRows] = await pool.execute(
      "SELECT Rate FROM Exchange_Rate WHERE From_Currency = ? AND To_Currency = ?",
      [fromCurrency, toCurrency],
    );
    const previous = (previousRows as Array<{ Rate: number }>)[0];
    await pool.execute(
      `INSERT INTO Exchange_Rate (From_Currency, To_Currency, Rate) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE Rate = VALUES(Rate), Updated_At = CURRENT_TIMESTAMP`,
      [fromCurrency, toCurrency, rateText],
    );

    try {
      const collection = await getRateHistoryCollection();
      await collection.insertOne({
        pair: `${fromCurrency}/${toCurrency}`,
        fromCurrency,
        toCurrency,
        rate,
        previousRate: previous?.Rate ?? null,
        updatedBy: admin.userId,
        recordedAt: new Date(),
      });
    } catch (error) {
      console.error("Exchange rate saved, but MongoDB history could not be recorded:", error);
      return NextResponse.json(
        { ok: true, warning: "Rate saved in MySQL, but MongoDB history logging failed. Check MongoDB." },
      );
    }
    return NextResponse.json({ ok: true, rate });
  } catch (error) {
    return errorResponse(error);
  }
}
