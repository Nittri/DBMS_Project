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
