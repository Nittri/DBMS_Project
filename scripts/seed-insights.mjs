import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const database = process.env.MONGODB_DATABASE;
if (!uri) throw new Error("Missing MONGODB_URI; set it in .env.local.");
if (!database) throw new Error("Missing MONGODB_DATABASE; set it in .env.local.");

const client = new MongoClient(uri);
try {
  await client.connect();
  const insights = client.db(database).collection("market_insights");
  await insights.createIndex({ pair: 1, publishedAt: -1 });
  const documents = [
    {
      pair: "USD/INR",
      title: "Sample market note",
      summary: "Demo content only; not a live quote or financial advice.",
      sentiment: "neutral",
      tags: ["sample", "demo"],
    },
    {
      pair: "EUR/USD",
      title: "Sample market note",
      summary: "Demo content only; connect a licensed market data provider before production use.",
      sentiment: "neutral",
      tags: ["sample", "demo"],
    },
  ];
  for (const document of documents) {
    await insights.updateOne(
      { pair: document.pair, title: document.title },
      { $setOnInsert: { ...document, publishedAt: new Date() } },
      { upsert: true },
    );
  }
  console.log("Sample market insights are ready.");
} finally {
  await client.close();
}
