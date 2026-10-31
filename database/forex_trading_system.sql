CREATE DATABASE IF NOT EXISTS forex_db;
USE forex_db;

-- This schema is intended for a fresh local development database.
DROP VIEW IF EXISTS View_Customer_Trade_Summary;
DROP PROCEDURE IF EXISTS ProcessDeposit;
DROP PROCEDURE IF EXISTS ExecuteTrade;
DROP TABLE IF EXISTS Payment;
DROP TABLE IF EXISTS Forex_Trade;
DROP TABLE IF EXISTS Margin_Transaction;
DROP TABLE IF EXISTS Margin_Account;
DROP TABLE IF EXISTS Trading_Account;
DROP TABLE IF EXISTS Exchange_Rate;
DROP TABLE IF EXISTS Currency;
DROP TABLE IF EXISTS Broker;
DROP TABLE IF EXISTS User_Account;
DROP TABLE IF EXISTS Customer;

CREATE TABLE Customer (
    Customer_ID INT AUTO_INCREMENT PRIMARY KEY,
    Name VARCHAR(100) NOT NULL,
    Email VARCHAR(254) NOT NULL UNIQUE,
    Phone VARCHAR(20) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE User_Account (
    User_ID INT AUTO_INCREMENT PRIMARY KEY,
    Customer_ID INT NOT NULL UNIQUE,
    Email VARCHAR(254) NOT NULL UNIQUE,
    Password_Hash VARCHAR(255) NOT NULL,
    Role ENUM('CUSTOMER', 'ADMIN') NOT NULL DEFAULT 'CUSTOMER',
    Created_At DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (Customer_ID) REFERENCES Customer(Customer_ID) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE Broker (
    Broker_ID INT AUTO_INCREMENT PRIMARY KEY,
    Name VARCHAR(100) NOT NULL,
    Email VARCHAR(254) NOT NULL UNIQUE,
    Commission_Rate DECIMAL(5, 4) NOT NULL DEFAULT 0.0010 CHECK (Commission_Rate >= 0)
) ENGINE=InnoDB;

CREATE TABLE Currency (
    Currency_Code CHAR(3) PRIMARY KEY,
    Currency_Name VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE Trading_Account (
    Account_ID INT AUTO_INCREMENT PRIMARY KEY,
    Customer_ID INT NOT NULL,
    Account_Type ENUM('Standard', 'VIP', 'Pro') NOT NULL DEFAULT 'Standard',
    Status ENUM('Active', 'Suspended', 'Closed') NOT NULL DEFAULT 'Active',
    Balance DECIMAL(15, 2) NOT NULL DEFAULT 0.00 CHECK (Balance >= 0),
    Created_At DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (Customer_ID) REFERENCES Customer(Customer_ID) ON DELETE CASCADE,
    INDEX idx_trading_acc_customer (Customer_ID)
) ENGINE=InnoDB;

CREATE TABLE Margin_Account (
    Margin_ID INT AUTO_INCREMENT PRIMARY KEY,
    Account_ID INT NOT NULL UNIQUE,
    Leverage DECIMAL(5, 2) NOT NULL DEFAULT 100.00 CHECK (Leverage > 0),
    Used_Margin DECIMAL(15, 2) NOT NULL DEFAULT 0.00 CHECK (Used_Margin >= 0),
    Free_Margin DECIMAL(15, 2) NOT NULL DEFAULT 0.00 CHECK (Free_Margin >= 0),
    Margin_Level DECIMAL(8, 2) NOT NULL DEFAULT 0.00 CHECK (Margin_Level >= 0),
    FOREIGN KEY (Account_ID) REFERENCES Trading_Account(Account_ID) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE Exchange_Rate (
    Rate_ID INT AUTO_INCREMENT PRIMARY KEY,
    From_Currency CHAR(3) NOT NULL,
    To_Currency CHAR(3) NOT NULL,
    Rate DECIMAL(12, 6) NOT NULL CHECK (Rate > 0),
    Updated_At DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT unique_currency_pair UNIQUE (From_Currency, To_Currency),
    FOREIGN KEY (From_Currency) REFERENCES Currency(Currency_Code),
    FOREIGN KEY (To_Currency) REFERENCES Currency(Currency_Code)
) ENGINE=InnoDB;

CREATE TABLE Forex_Trade (
    Trade_ID INT AUTO_INCREMENT PRIMARY KEY,
    Account_ID INT NOT NULL,
    Broker_ID INT NOT NULL,
    From_Currency CHAR(3) NOT NULL,
    To_Currency CHAR(3) NOT NULL,
    Amount DECIMAL(15, 2) NOT NULL CHECK (Amount > 0),
    Trade_Type ENUM('BUY', 'SELL') NOT NULL,
    Status ENUM('OPEN', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    Open_Rate DECIMAL(12, 6) NOT NULL CHECK (Open_Rate > 0),
    Close_Rate DECIMAL(12, 6) NULL,
    Profit_Loss DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    Created_At DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (Account_ID) REFERENCES Trading_Account(Account_ID) ON DELETE CASCADE,
    FOREIGN KEY (Broker_ID) REFERENCES Broker(Broker_ID),
    FOREIGN KEY (From_Currency) REFERENCES Currency(Currency_Code),
    FOREIGN KEY (To_Currency) REFERENCES Currency(Currency_Code),
    INDEX idx_forex_trade_account_created (Account_ID, Created_At),
    INDEX idx_forex_trade_broker (Broker_ID)
) ENGINE=InnoDB;

CREATE TABLE Margin_Transaction (
    Transaction_ID INT AUTO_INCREMENT PRIMARY KEY,
    Margin_ID INT NOT NULL,
    Amount DECIMAL(15, 2) NOT NULL CHECK (Amount > 0),
    Type ENUM('RESERVE', 'RELEASE', 'CALL') NOT NULL,
    Created_At DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (Margin_ID) REFERENCES Margin_Account(Margin_ID) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE Payment (
    Payment_ID INT AUTO_INCREMENT PRIMARY KEY,
    Account_ID INT NOT NULL,
    Broker_ID INT NOT NULL,
    Amount DECIMAL(15, 2) NOT NULL CHECK (Amount > 0),
    Type ENUM('DEPOSIT', 'WITHDRAWAL') NOT NULL,
    Status ENUM('PENDING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'COMPLETED',
    Payment_Date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (Account_ID) REFERENCES Trading_Account(Account_ID) ON DELETE CASCADE,
    FOREIGN KEY (Broker_ID) REFERENCES Broker(Broker_ID),
    INDEX idx_payment_account_date (Account_ID, Payment_Date)
) ENGINE=InnoDB;

CREATE OR REPLACE VIEW View_Customer_Trade_Summary AS
SELECT
    c.Customer_ID,
    c.Name AS Customer_Name,
    ta.Account_ID,
    ta.Account_Type,
    ta.Status AS Account_Status,
    ta.Balance,
    ma.Used_Margin,
    ma.Free_Margin,
    ma.Leverage,
    COUNT(ft.Trade_ID) AS Total_Trades,
    COALESCE(SUM(ft.Profit_Loss), 0) AS Total_PnL
FROM Customer c
JOIN Trading_Account ta ON ta.Customer_ID = c.Customer_ID
LEFT JOIN Margin_Account ma ON ma.Account_ID = ta.Account_ID
LEFT JOIN Forex_Trade ft ON ft.Account_ID = ta.Account_ID
GROUP BY c.Customer_ID, c.Name, ta.Account_ID, ta.Account_Type, ta.Status,
         ta.Balance, ma.Used_Margin, ma.Free_Margin, ma.Leverage;

DELIMITER //

CREATE PROCEDURE ProcessDeposit(
    IN p_Account_ID INT,
    IN p_Broker_ID INT,
    IN p_Amount DECIMAL(15, 2)
)
BEGIN
    DECLARE v_account_id INT DEFAULT NULL;
    DECLARE v_margin_id INT DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_Amount IS NULL OR p_Amount <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Deposit amount must be positive.';
    END IF;

    START TRANSACTION;
    SELECT Account_ID INTO v_account_id
    FROM Trading_Account
    WHERE Account_ID = p_Account_ID AND Status = 'Active'
    FOR UPDATE;

    IF v_account_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Active Trading Account not found.';
    END IF;

    SELECT Margin_ID INTO v_margin_id
    FROM Margin_Account
    WHERE Account_ID = p_Account_ID
    FOR UPDATE;
    IF v_margin_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Margin Account not found.';
    END IF;

    UPDATE Trading_Account SET Balance = Balance + p_Amount
    WHERE Account_ID = p_Account_ID;
    UPDATE Margin_Account SET Free_Margin = Free_Margin + p_Amount
    WHERE Margin_ID = v_margin_id;
    INSERT INTO Payment (Account_ID, Broker_ID, Amount, Type, Status)
    VALUES (p_Account_ID, p_Broker_ID, p_Amount, 'DEPOSIT', 'COMPLETED');
    COMMIT;
END //

CREATE PROCEDURE ExecuteTrade(
    IN p_Account_ID INT,
    IN p_Broker_ID INT,
    IN p_From_Currency CHAR(3),
    IN p_To_Currency CHAR(3),
    IN p_Amount DECIMAL(15, 2),
    IN p_Trade_Type VARCHAR(10)
)
BEGIN
    DECLARE v_rate DECIMAL(12, 6) DEFAULT NULL;
    DECLARE v_margin_id INT DEFAULT NULL;
    DECLARE v_leverage DECIMAL(5, 2) DEFAULT NULL;
    DECLARE v_free_margin DECIMAL(15, 2) DEFAULT NULL;
    DECLARE v_margin_required DECIMAL(15, 2);
    DECLARE v_status VARCHAR(20) DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_Amount IS NULL OR p_Amount <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Trade amount must be positive.';
    END IF;
    IF p_Trade_Type NOT IN ('BUY', 'SELL') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Trade type must be BUY or SELL.';
    END IF;

    START TRANSACTION;
    SELECT Status INTO v_status FROM Trading_Account
    WHERE Account_ID = p_Account_ID FOR UPDATE;
    IF v_status IS NULL OR v_status <> 'Active' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Active Trading Account not found.';
    END IF;

    SELECT Rate INTO v_rate FROM Exchange_Rate
    WHERE From_Currency = p_From_Currency AND To_Currency = p_To_Currency;
    IF v_rate IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exchange Rate not found for currency pair.';
    END IF;

    SELECT Margin_ID, Leverage, Free_Margin
    INTO v_margin_id, v_leverage, v_free_margin
    FROM Margin_Account WHERE Account_ID = p_Account_ID FOR UPDATE;
    IF v_margin_id IS NULL OR v_leverage IS NULL OR v_leverage <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Valid Margin Account not found.';
    END IF;

    SET v_margin_required = ROUND(p_Amount / v_leverage, 2);
    IF v_free_margin < v_margin_required THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Insufficient Free Margin to execute trade.';
    END IF;

    INSERT INTO Forex_Trade
        (Account_ID, Broker_ID, From_Currency, To_Currency, Amount, Trade_Type, Status, Open_Rate)
    VALUES
        (p_Account_ID, p_Broker_ID, p_From_Currency, p_To_Currency, p_Amount, p_Trade_Type, 'OPEN', v_rate);
    UPDATE Margin_Account
    SET Used_Margin = Used_Margin + v_margin_required,
        Free_Margin = Free_Margin - v_margin_required
    WHERE Margin_ID = v_margin_id;
    INSERT INTO Margin_Transaction (Margin_ID, Amount, Type)
    VALUES (v_margin_id, v_margin_required, 'RESERVE');
    COMMIT;
END //

DELIMITER ;

INSERT INTO Customer (Name, Email, Phone) VALUES
('Puneet Lingashettar', 'puneet@example.com', '+919876543210'),
('R G Nithik', 'nithik@example.com', '+919876543211');

INSERT INTO Broker (Name, Email, Commission_Rate) VALUES
('Global Forex Prime', 'support@globalforex.com', 0.0015),
('Apex Forex Ltd', 'contact@apexforex.com', 0.0010);

INSERT INTO Currency (Currency_Code, Currency_Name) VALUES
('USD', 'US Dollar'), ('INR', 'Indian Rupee'), ('EUR', 'Euro'),
('GBP', 'British Pound'), ('JPY', 'Japanese Yen');

INSERT INTO Exchange_Rate (From_Currency, To_Currency, Rate) VALUES
('USD', 'INR', 83.500000), ('EUR', 'USD', 1.085000),
('GBP', 'USD', 1.270000), ('USD', 'JPY', 155.200000);

INSERT INTO Trading_Account (Customer_ID, Account_Type, Balance, Status) VALUES
(1, 'VIP', 10000.00, 'Active'), (2, 'Standard', 5000.00, 'Active');

INSERT INTO Margin_Account (Account_ID, Leverage, Used_Margin, Free_Margin, Margin_Level) VALUES
(1, 100.00, 0.00, 10000.00, 100.00), (2, 50.00, 0.00, 5000.00, 100.00);

CALL ProcessDeposit(1, 1, 2000.00);
CALL ExecuteTrade(1, 1, 'USD', 'INR', 5000.00, 'BUY');

SELECT * FROM View_Customer_Trade_Summary;
