import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}
if (process.env.DB_MIGRATION_USER && !process.env.DB_MIGRATION_PASSWORD) {
  throw new Error("DB_MIGRATION_PASSWORD is required when DB_MIGRATION_USER is set.");
}

const schema = await readFile(resolve(root, "database/forex_trading_system.sql"), "utf8");
const marker = "-- Advanced trading, withdrawal, and payment-review operations.";
const start = schema.indexOf(marker);
if (start < 0) throw new Error("Could not locate the management workflow definitions in the schema file.");

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_MIGRATION_USER ?? (process.env.MYSQL_ROOT_PASSWORD ? "root" : process.env.DB_USER),
  password: process.env.DB_MIGRATION_PASSWORD ?? process.env.MYSQL_ROOT_PASSWORD ?? process.env.DB_PASSWORD,
});

function splitSqlStatements(source) {
  const statements = [];
  let delimiter = ";";
  let statement = "";

  for (const line of source.split(/\r?\n/)) {
    const directive = line.match(/^\s*DELIMITER\s+(.+?)\s*$/i);
    if (directive) {
      if (statement.trim()) throw new Error("Unexpected content before a SQL DELIMITER directive.");
      delimiter = directive[1];
      continue;
    }

    statement += `${line}\n`;
    const trimmed = statement.trimEnd();
    if (trimmed.endsWith(delimiter)) {
      statements.push(trimmed.slice(0, -delimiter.length).trim());
      statement = "";
    }
  }
  if (statement.trim()) statements.push(statement.trim());
  return statements.filter(Boolean);
}

try {
  const [columns] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Payment'`,
  );
  const present = new Set(columns.map((column) => column.COLUMN_NAME));
  if (!present.size) throw new Error("Payment table is missing; initialize the original schema before migrating.");

  const [userColumns] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User_Account'`,
  );
  const userColumnNames = new Set(userColumns.map((column) => column.COLUMN_NAME));
  if (!userColumnNames.has("Broker_ID")) {
    await connection.query("ALTER TABLE User_Account ADD COLUMN Broker_ID INT NULL UNIQUE");
    await connection.query(
      "ALTER TABLE User_Account ADD CONSTRAINT fk_user_account_broker FOREIGN KEY (Broker_ID) REFERENCES Broker(Broker_ID) ON DELETE CASCADE",
    );
  }
  await connection.query(
    "ALTER TABLE User_Account MODIFY Customer_ID INT NULL, MODIFY Role ENUM('CUSTOMER', 'ADMIN', 'BROKER') NOT NULL DEFAULT 'CUSTOMER'",
  );

  const [userChecks] = await connection.query(
    `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'User_Account'
       AND CONSTRAINT_NAME = 'chk_user_account_identity'`,
  );
  if (!userChecks.length) {
    await connection.query(
      `ALTER TABLE User_Account ADD CONSTRAINT chk_user_account_identity CHECK (
        (Role IN ('CUSTOMER', 'ADMIN') AND Customer_ID IS NOT NULL AND Broker_ID IS NULL) OR
        (Role = 'BROKER' AND Customer_ID IS NULL AND Broker_ID IS NOT NULL)
      )`,
    );
  }

  if (!present.has("Reviewed_By")) {
    await connection.query("ALTER TABLE Payment ADD COLUMN Reviewed_By INT NULL");
    await connection.query(
      "ALTER TABLE Payment ADD CONSTRAINT fk_payment_reviewer FOREIGN KEY (Reviewed_By) REFERENCES User_Account(User_ID) ON DELETE SET NULL",
    );
  }
  if (!present.has("Reviewed_At")) {
    await connection.query("ALTER TABLE Payment ADD COLUMN Reviewed_At DATETIME NULL");
  }
  if (!present.has("Review_Note")) {
    await connection.query("ALTER TABLE Payment ADD COLUMN Review_Note VARCHAR(255) NULL");
  }

  const [rateColumns] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Exchange_Rate'`,
  );
  if (!new Set(rateColumns.map((column) => column.COLUMN_NAME)).has("Rate_Source")) {
    await connection.query(
      "ALTER TABLE Exchange_Rate ADD COLUMN Rate_Source ENUM('ADMIN', 'FRANKFURTER') NOT NULL DEFAULT 'ADMIN'",
    );
  }
  await connection.query(
    `CREATE TABLE IF NOT EXISTS Exchange_Rate_Sync (
       Sync_ID TINYINT PRIMARY KEY,
       Provider_Date DATE NULL,
       Last_Checked_At DATETIME NULL,
       Last_Success_At DATETIME NULL,
       Last_Error VARCHAR(255) NULL,
       CONSTRAINT chk_single_rate_sync_row CHECK (Sync_ID = 1)
     ) ENGINE=InnoDB`,
  );
  await connection.query("INSERT IGNORE INTO Exchange_Rate_Sync (Sync_ID) VALUES (1)");

  await connection.query(
    `CREATE OR REPLACE VIEW View_Customer_Trade_Summary AS
     SELECT c.Customer_ID, c.Name AS Customer_Name, ta.Account_ID, ta.Account_Type,
       ta.Status AS Account_Status, ta.Balance, ma.Used_Margin, ma.Free_Margin,
       ma.Margin_Level, ma.Leverage, COUNT(ft.Trade_ID) AS Total_Trades,
       COALESCE(SUM(ft.Profit_Loss), 0) AS Total_PnL,
       COALESCE(SUM(CASE WHEN ft.Status = 'OPEN' THEN 1 ELSE 0 END), 0) AS Active_Trades,
       ta.Balance + COALESCE(SUM(
         CASE WHEN ft.Status = 'OPEN' AND er.Rate IS NOT NULL THEN
           ft.Amount * (er.Rate - ft.Open_Rate) / ft.Open_Rate *
           CASE WHEN ft.Trade_Type = 'BUY' THEN 1 ELSE -1 END
         ELSE 0 END
       ), 0) AS Current_Portfolio_Value
     FROM Customer c
     JOIN Trading_Account ta ON ta.Customer_ID = c.Customer_ID
     LEFT JOIN Margin_Account ma ON ma.Account_ID = ta.Account_ID
     LEFT JOIN Forex_Trade ft ON ft.Account_ID = ta.Account_ID
     LEFT JOIN Exchange_Rate er
       ON er.From_Currency = ft.From_Currency AND er.To_Currency = ft.To_Currency
     GROUP BY c.Customer_ID, c.Name, ta.Account_ID, ta.Account_Type, ta.Status,
       ta.Balance, ma.Used_Margin, ma.Free_Margin, ma.Margin_Level, ma.Leverage`,
  );

  const [indexes] = await connection.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Forex_Trade'
       AND INDEX_NAME = 'idx_forex_trade_pair'`,
  );
  if (!indexes.length) {
    await connection.query(
      "ALTER TABLE Forex_Trade ADD INDEX idx_forex_trade_pair (From_Currency, To_Currency, Created_At)",
    );
  }

  const statements = splitSqlStatements(schema.slice(start));
  for (const statement of statements) await connection.query(statement);
  console.log(`Applied payment review columns and ${statements.length} replaceable database definitions.`);
} finally {
  await connection.end();
}
