import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getInsightsCollection } from "@/lib/mongo";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireSession();
    const collection = await getInsightsCollection();
    const insights = await collection.find({}, {
      projection: { _id: 0, pair: 1, title: 1, summary: 1, sentiment: 1, tags: 1, publishedAt: 1 },
    }).sort({ publishedAt: -1 }).limit(10).toArray();
    return NextResponse.json({ insights });
  } catch (error) {
    return errorResponse(error);
  }
}
