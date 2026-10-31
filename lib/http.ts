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
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "ER_ACCESS_DENIED_ERROR") {
      return NextResponse.json(
        { error: "MySQL rejected the app credentials. Check DB_USER and DB_PASSWORD in .env.local, then restart the app." },
        { status: 503 },
      );
    }
    if (error.code === "ER_BAD_DB_ERROR") {
      return NextResponse.json(
        { error: "The forex_db database is missing. Create it and import database/forex_trading_system.sql." },
        { status: 503 },
      );
    }
    if (error.code === "ER_NO_SUCH_TABLE" || error.code === "ER_SP_DOES_NOT_EXIST") {
      return NextResponse.json(
        { error: "The database schema is incomplete. Import database/forex_trading_system.sql into forex_db." },
        { status: 503 },
      );
    }
  }
  if (error instanceof Error && error.message.startsWith("SESSION_SECRET")) {
    return NextResponse.json(
      { error: "Set SESSION_SECRET to a random value of at least 32 characters in .env.local, then restart the app." },
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
