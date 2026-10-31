import { MongoClient } from "mongodb";

const globalForMongo = globalThis as typeof globalThis & {
  mongoClientPromise?: Promise<MongoClient>;
};

export async function getInsightsCollection() {
  const uri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DATABASE;
  if (!uri) throw new Error("Missing required environment variable: MONGODB_URI");
  if (!databaseName) throw new Error("Missing required environment variable: MONGODB_DATABASE");

  const clientPromise =
    globalForMongo.mongoClientPromise ??
    new MongoClient(uri, { serverSelectionTimeoutMS: 3000 }).connect();
  if (process.env.NODE_ENV !== "production") globalForMongo.mongoClientPromise = clientPromise;

  const client = await clientPromise;
  return client.db(databaseName).collection<{
    pair: string;
    title: string;
    summary: string;
    sentiment: "positive" | "negative" | "neutral";
    tags: string[];
    publishedAt: Date;
  }>("market_insights");
}

export async function getRateHistoryCollection() {
  const uri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DATABASE;
  if (!uri) throw new Error("Missing required environment variable: MONGODB_URI");
  if (!databaseName) throw new Error("Missing required environment variable: MONGODB_DATABASE");

  const clientPromise =
    globalForMongo.mongoClientPromise ??
    new MongoClient(uri, { serverSelectionTimeoutMS: 3000 }).connect();
  if (process.env.NODE_ENV !== "production") globalForMongo.mongoClientPromise = clientPromise;

  const client = await clientPromise;
  const history = client.db(databaseName).collection<{
    pair: string;
    fromCurrency: string;
    toCurrency: string;
    rate: number;
    previousRate: number | null;
    updatedBy: number | null;
    recordedAt: Date;
  }>("exchange_rate_history");
  await history.createIndex({ pair: 1, recordedAt: -1 });
  return history;
}
