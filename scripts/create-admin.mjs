import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import mysql from "mysql2/promise";

const required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing ${key}; load values from .env.local first.`);
}

const terminal = createInterface({ input: stdin, output: stdout });
try {
  const name = (await terminal.question("Administrator name: ")).trim();
  const email = (await terminal.question("Administrator email: ")).trim().toLowerCase();
  const phone = (await terminal.question("Administrator phone: ")).trim();
  const password = await terminal.question("Administrator password (10+ characters): ");
  if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 || !phone || phone.length > 20 || password.length < 10 || password.length > 128) {
    throw new Error("Invalid input; password must be between 10 and 128 characters.");
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
    const [customerResult] = await connection.execute(
      "INSERT INTO Customer (Name, Email, Phone) VALUES (?, ?, ?)", [name, email, phone],
    );
    const customerId = customerResult.insertId;
    await connection.execute(
      "INSERT INTO User_Account (Customer_ID, Email, Password_Hash, Role) VALUES (?, ?, ?, 'ADMIN')",
      [customerId, email, passwordHash],
    );
    const [accountResult] = await connection.execute(
      "INSERT INTO Trading_Account (Customer_ID, Account_Type, Balance) VALUES (?, 'VIP', 0)",
      [customerId],
    );
    await connection.execute(
      "INSERT INTO Margin_Account (Account_ID, Leverage, Free_Margin) VALUES (?, 50, 0)",
      [accountResult.insertId],
    );
    await connection.commit();
    console.log("Administrator created.");
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
} finally {
  terminal.close();
}
