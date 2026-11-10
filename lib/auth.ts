import { randomBytes, scrypt as callbackScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const scrypt = promisify(callbackScrypt);
const cookieName = "forex_session";
const sessionDurationSeconds = 60 * 60 * 8;

export type Role = "CUSTOMER" | "ADMIN" | "BROKER";
export type Session = {
  userId: number;
  customerId: number | null;
  brokerId: number | null;
  email: string;
  role: Role;
};
export type CustomerSession = Session & { customerId: number };
export type BrokerSession = Session & { brokerId: number };

function secretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, hash] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !hash || !/^[a-f0-9]{128}$/i.test(hash)) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function createSession(session: Session) {
  const token = await new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${sessionDurationSeconds}s`)
    .sign(secretKey());
  const cookieStore = await cookies();
  cookieStore.set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: sessionDurationSeconds,
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(cookieName);
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (
      typeof payload.userId !== "number" ||
      (typeof payload.customerId !== "number" && payload.customerId !== null) ||
      (typeof payload.brokerId !== "number" && payload.brokerId !== null) ||
      typeof payload.email !== "string" ||
      (payload.role !== "CUSTOMER" && payload.role !== "ADMIN" && payload.role !== "BROKER") ||
      (payload.role === "BROKER" && (payload.customerId !== null || typeof payload.brokerId !== "number")) ||
      (payload.role !== "BROKER" && (typeof payload.customerId !== "number" || payload.brokerId !== null))
    ) return null;
    return {
      userId: payload.userId,
      customerId: payload.customerId,
      brokerId: payload.brokerId,
      email: payload.email,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (session.role !== "ADMIN") throw new Error("FORBIDDEN");
  return session;
}

export async function requireBrokerOrAdmin(): Promise<Session> {
  const session = await requireSession();
  if (session.role !== "ADMIN" && session.role !== "BROKER") throw new Error("FORBIDDEN");
  return session;
}

export async function requireCustomer(): Promise<CustomerSession> {
  const session = await requireSession();
  if (session.role !== "CUSTOMER" && session.role !== "ADMIN" || session.customerId === null) {
    throw new Error("CUSTOMER_ACCESS_REQUIRED");
  }
  return session as CustomerSession;
}
