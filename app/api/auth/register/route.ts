import { NextResponse } from "next/server";
import { createSession, hashPassword } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { errorResponse, readJson } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const input = await readJson(request);
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
  const phone = typeof input?.phone === "string" ? input.phone.trim() : "";
  const password = typeof input?.password === "string" ? input.password : "";

  if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 || !phone || phone.length > 20 ||
      password.length < 10 || password.length > 128) {
    return NextResponse.json(
      { error: "Enter a valid name, email, phone, and password (10–128 characters)." },
      { status: 400 },
    );
  }

  const connection = await getPool().getConnection();
  try {
    const passwordHash = await hashPassword(password);
    await connection.beginTransaction();
    const [customerResult] = await connection.execute(
      "INSERT INTO Customer (Name, Email, Phone) VALUES (?, ?, ?)",
      [name, email, phone],
    );
    const customerId = (customerResult as { insertId: number }).insertId;
    const [userResult] = await connection.execute(
      "INSERT INTO User_Account (Customer_ID, Email, Password_Hash, Role) VALUES (?, ?, ?, 'CUSTOMER')",
      [customerId, email, passwordHash],
    );
    const userId = (userResult as { insertId: number }).insertId;
    const [accountResult] = await connection.execute(
      "INSERT INTO Trading_Account (Customer_ID, Account_Type, Balance) VALUES (?, 'Standard', 0)",
      [customerId],
    );
    const accountId = (accountResult as { insertId: number }).insertId;
    await connection.execute(
      "INSERT INTO Margin_Account (Account_ID, Leverage, Free_Margin) VALUES (?, 50, 0)",
      [accountId],
    );
    await connection.commit();
    await createSession({ userId, customerId, email, role: "CUSTOMER" });
    return NextResponse.json({ user: { userId, customerId, email, role: "CUSTOMER" } }, { status: 201 });
  } catch (error) {
    await connection.rollback();
    if (typeof error === "object" && error !== null && "code" in error &&
        (error.code === "ER_DUP_ENTRY")) {
      return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
    }
    return errorResponse(error);
  } finally {
    connection.release();
  }
}
