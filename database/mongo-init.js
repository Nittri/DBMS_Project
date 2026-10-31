db = db.getSiblingDB("forex_insights");
db.market_insights.createIndex({ pair: 1, publishedAt: -1 });
db.market_insights.insertMany([
  {
    pair: "USD/INR",
    title: "Sample market note",
    summary: "Demo content only; not a live quote or financial advice.",
    sentiment: "neutral",
    tags: ["sample", "demo"],
    publishedAt: new Date()
  },
  {
    pair: "EUR/USD",
    title: "Sample market note",
    summary: "Demo content only; connect a licensed market data provider before production use.",
    sentiment: "neutral",
    tags: ["sample", "demo"],
    publishedAt: new Date()
  }
]);
