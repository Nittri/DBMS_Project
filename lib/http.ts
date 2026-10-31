import { NextResponse } from "next/server";

export function errorResponse(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  }
  if (error instanceof Error && error.message.startsWith("Missing required environment variable: DB_")) {
    return NextResponse.json(
      { error: "Database isn't configured. Copy .env.example to .env.local, set the database values, then restart the app." },
      { status: 503 },
    );
  }
  if (typeof error === "object" && error !== null && "code" in error &&
      (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT" || error.code === "ENOTFOUND")) {
    return NextResponse.json(
      { error: "The database isn't reachable. Start MySQL and check the connection settings in .env.local." },
      { status: 503 },
    );
  }
  console.error("API request failed:", error);
  return NextResponse.json({ error: "The request could not be completed." }, { status: 500 });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body !== null && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
