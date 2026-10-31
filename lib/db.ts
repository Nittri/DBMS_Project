import mysql, { type Pool } from "mysql2/promise";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"] as const;
    for (const key of required) {
      if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
    }

    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 3306),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      connectionLimit: 10,
      decimalNumbers: true,
      waitForConnections: true,
      queueLimit: 0,
    });
  }
  return pool;
}
