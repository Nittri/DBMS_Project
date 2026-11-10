import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import mysql from "mysql2/promise";

for (const key of ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"]) {
  if (!process.env[key]) throw new Error(`Missing ${key}; load values from .env.local first.`);
}

const terminal = createInterface({ input: stdin, output: stdout });
try {
  const name = (await terminal.question("Broker name: ")).trim();
  const email = (await terminal.question("Broker login email: ")).trim().toLowerCase();
  const commissionText = (await terminal.question("Commission rate (0-1, default 0.001): ")).trim() || "0.001";
  const password = await terminal.question("Broker password (10+ characters): ");
  const commission = Number(commissionText);
  if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 || !Number.isFinite(commission) || commission < 0 || commission > 1 ||
      !/^\d+(?:\.\d{1,4})?$/.test(commissionText) ||
      password.length < 10 || password.length > 128) {
    throw new Error("Invalid input; enter a valid broker, email, commission, and 10–128 character password.");
  }

  const salt = randomBytes(16).toString("hex");
  const passwordHash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  try {
    await connection.beginTransaction();
    const [brokerResult] = await connection.execute(
      "INSERT INTO Broker (Name, Email, Commission_Rate) VALUES (?, ?, ?)",
      [name, email, commissionText],
    );
    const brokerId = (brokerResult as { insertId: number }).insertId;
    await connection.execute(
      "INSERT INTO User_Account (Broker_ID, Email, Password_Hash, Role) VALUES (?, ?, ?, 'BROKER')",
      [brokerId, email, passwordHash],
    );
    await connection.commit();
    console.log("Broker login created. Sign in with the broker email and password.");
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
} finally {
  terminal.close();
}
