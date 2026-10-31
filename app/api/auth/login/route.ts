import { NextResponse } from "next/server";
import { createSession, verifyPassword } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { errorResponse, readJson } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const input = await readJson(request);
  const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input?.password === "string" ? input.password : "";
  if (!email || !password || email.length > 254 || password.length > 128) {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }

  try {
    const [rows] = await getPool().execute(
      "SELECT User_ID, Customer_ID, Email, Password_Hash, Role FROM User_Account WHERE Email = ? LIMIT 1",
      [email],
    );
    const user = (rows as Array<{
      User_ID: number; Customer_ID: number; Email: string; Password_Hash: string; Role: "CUSTOMER" | "ADMIN";
    }>)[0];
    if (!user || !(await verifyPassword(password, user.Password_Hash))) {
      return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    }
    const session = {
      userId: user.User_ID,
      customerId: user.Customer_ID,
      email: user.Email,
      role: user.Role,
    };
    await createSession(session);
    return NextResponse.json({ user: session });
  } catch (error) {
    return errorResponse(error);
  }
}
