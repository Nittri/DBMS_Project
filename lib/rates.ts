import type { Pool, RowDataPacket } from "mysql2/promise";
import { getRateHistoryCollection } from "@/lib/mongo";

const providerName = "Frankfurter (ECB reference rates)";
const refreshIntervalMs = 6 * 60 * 60 * 1000;
const globalForRates = globalThis as typeof globalThis & {
  referenceRateRefresh?: Promise<RateRefreshResult>;
};

type SyncRow = {
  Provider_Date: string | null;
  Last_Checked_At: Date | null;
  Last_Success_At: Date | null;
  Last_Error: string | null;
} & RowDataPacket;

type CurrencyRow = {
  Currency_Code: string;
} & RowDataPacket;

type PairRow = {
  From_Currency: string;
  To_Currency: string;
  Rate: number;
  Rate_Source: string;
} & RowDataPacket;

type RateHistoryDocument = {
  pair: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  previousRate: number | null;
  source: string;
  providerDate?: Date;
  updatedBy: number | null;
  recordedAt: Date;
};

type RateRefreshResult = {
  provider: string;
  interval: string;
  attempted: boolean;
  providerDate: string | null;
  lastCheckedAt: Date | null;
  lastSuccessAt: Date | null;
  error: string | null;
  historyWarning?: string;
};

type FrankfurterResponse = {
  base?: unknown;
  date?: unknown;
  rates?: unknown;
};

export async function refreshReferenceRates(
  pool: Pool,
  force = false,
): Promise<RateRefreshResult> {
  if (globalForRates.referenceRateRefresh) return globalForRates.referenceRateRefresh;
  const task = refresh(pool, force);
  globalForRates.referenceRateRefresh = task;
  try {
    return await task;
  } finally {
    globalForRates.referenceRateRefresh = undefined;
  }
}

async function refresh(pool: Pool, force: boolean): Promise<RateRefreshResult> {
  const connection = await pool.getConnection();
  let sync: SyncRow;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<SyncRow[]>(
      `SELECT Provider_Date, Last_Checked_At, Last_Success_At, Last_Error
       FROM Exchange_Rate_Sync WHERE Sync_ID = 1 FOR UPDATE`,
    ) as [SyncRow[], unknown];
    if (!rows[0]) throw new Error("Exchange-rate sync state is not initialized; run npm run db:migrate.");
    sync = rows[0];
    if (!force && sync.Last_Checked_At &&
        Date.now() - new Date(sync.Last_Checked_At).getTime() < refreshIntervalMs) {
      await connection.commit();
      return result(sync, false);
    }

    await connection.query(
      "UPDATE Exchange_Rate_Sync SET Last_Checked_At = CURRENT_TIMESTAMP WHERE Sync_ID = 1",
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  try {
    const [currencyRows] = await pool.query<CurrencyRow[]>(
      "SELECT Currency_Code FROM Currency ORDER BY Currency_Code",
    ) as [CurrencyRow[], unknown];
    const currencies = currencyRows.map((row) => row.Currency_Code);
    const symbols = currencies.filter((code) => code !== "USD");
    const url = new URL("https://api.frankfurter.dev/v1/latest");
    url.searchParams.set("base", "USD");
    if (symbols.length) url.searchParams.set("symbols", symbols.join(","));

    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Reference-rate provider returned HTTP ${response.status}.`);
    const payload = await response.json() as FrankfurterResponse;
    if (payload.base !== "USD" || typeof payload.date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(payload.date) ||
        payload.rates === null || typeof payload.rates !== "object" || Array.isArray(payload.rates)) {
      throw new Error("Reference-rate provider returned an invalid response.");
    }

    const usdRates = new Map<string, number>([["USD", 1]]);
    for (const [currency, value] of Object.entries(payload.rates)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new Error(`Reference-rate provider returned an invalid ${currency} rate.`);
      }
      usdRates.set(currency, value);
    }

    const [pairRows] = await pool.query<PairRow[]>(
      "SELECT From_Currency, To_Currency, Rate, Rate_Source FROM Exchange_Rate",
    ) as [PairRow[], unknown];
    const updates = pairRows.flatMap((pair) => {
      const base = usdRates.get(pair.From_Currency);
      const quote = usdRates.get(pair.To_Currency);
      if (!base || !quote) return [];
      const rate = Number((quote / base).toFixed(6));
      if (!Number.isFinite(rate) || rate <= 0) return [];
      return [{ ...pair, rate }];
    });

    const updateConnection = await pool.getConnection();
    const historyDocuments: RateHistoryDocument[] = [];
    try {
      await updateConnection.beginTransaction();
      for (const item of updates) {
        if (Number(item.Rate) === item.rate && item.Rate_Source === "FRANKFURTER") continue;
        await updateConnection.execute(
          `UPDATE Exchange_Rate SET Rate = ?, Rate_Source = 'FRANKFURTER'
           WHERE From_Currency = ? AND To_Currency = ?`,
          [item.rate, item.From_Currency, item.To_Currency],
        );
        historyDocuments.push({
          pair: `${item.From_Currency}/${item.To_Currency}`,
          fromCurrency: item.From_Currency,
          toCurrency: item.To_Currency,
          rate: item.rate,
          previousRate: Number(item.Rate),
          source: "FRANKFURTER",
          providerDate: new Date(`${payload.date}T00:00:00.000Z`),
          updatedBy: null,
          recordedAt: new Date(),
        });
      }
      await updateConnection.execute(
        `UPDATE Exchange_Rate_Sync
         SET Provider_Date = ?, Last_Success_At = CURRENT_TIMESTAMP, Last_Error = NULL
         WHERE Sync_ID = 1`,
        [payload.date],
      );
      await updateConnection.commit();
    } catch (error) {
      await updateConnection.rollback();
      throw error;
    } finally {
      updateConnection.release();
    }

    let historyWarning: string | undefined;
    if (historyDocuments.length) {
      try {
        await (await getRateHistoryCollection()).insertMany(historyDocuments);
      } catch (error) {
        console.error("Could not save provider rate history to MongoDB:", error);
        historyWarning = "Reference rates updated, but MongoDB history logging failed.";
      }
    }

    const [syncRows] = await pool.query<SyncRow[]>(
      `SELECT Provider_Date, Last_Checked_At, Last_Success_At, Last_Error
       FROM Exchange_Rate_Sync WHERE Sync_ID = 1`,
    ) as [SyncRow[], unknown];
    const refreshed = result(syncRows[0], true);
    return { ...refreshed, error: null, historyWarning };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rate refresh failed.";
    await pool.execute(
      "UPDATE Exchange_Rate_Sync SET Last_Error = ? WHERE Sync_ID = 1",
      [message.slice(0, 255)],
    );
    const [rows] = await pool.query<SyncRow[]>(
      `SELECT Provider_Date, Last_Checked_At, Last_Success_At, Last_Error
       FROM Exchange_Rate_Sync WHERE Sync_ID = 1`,
    ) as [SyncRow[], unknown];
    return result(rows[0], true);
  }
}

function result(sync: SyncRow, attempted: boolean): RateRefreshResult {
  return {
    provider: providerName,
    interval: "Daily reference rates; refresh checks at most every six hours.",
    attempted,
    providerDate: sync.Provider_Date,
    lastCheckedAt: sync.Last_Checked_At,
    lastSuccessAt: sync.Last_Success_At,
    error: sync.Last_Error,
  };
}
