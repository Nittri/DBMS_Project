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
    INDEX idx_forex_trade_pair (From_Currency, To_Currency, Created_At),
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
    Reviewed_By INT NULL,
    Reviewed_At DATETIME NULL,
    Review_Note VARCHAR(255) NULL,
    FOREIGN KEY (Account_ID) REFERENCES Trading_Account(Account_ID) ON DELETE CASCADE,
    FOREIGN KEY (Broker_ID) REFERENCES Broker(Broker_ID),
    FOREIGN KEY (Reviewed_By) REFERENCES User_Account(User_ID) ON DELETE SET NULL,
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
    ma.Margin_Level,
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

-- Advanced trading, withdrawal, and payment-review operations.
DROP TRIGGER IF EXISTS After_Trade_Insert;
DROP TRIGGER IF EXISTS Prevent_Negative_Balance;
DROP TRIGGER IF EXISTS Prevent_Negative_Balance_Update;
DROP FUNCTION IF EXISTS CalculateProfitLoss;
DROP PROCEDURE IF EXISTS ProcessDeposit;
DROP PROCEDURE IF EXISTS ExecuteTrade;
DROP PROCEDURE IF EXISTS CloseTrade;
DROP PROCEDURE IF EXISTS RequestWithdrawal;
DROP PROCEDURE IF EXISTS ReviewWithdrawal;

DELIMITER //

CREATE FUNCTION CalculateProfitLoss(
    p_Amount DECIMAL(15, 2),
    p_Open_Rate DECIMAL(12, 6),
    p_Close_Rate DECIMAL(12, 6),
    p_Trade_Type VARCHAR(10)
)
RETURNS DECIMAL(15, 2)
DETERMINISTIC
NO SQL
BEGIN
    IF p_Amount IS NULL OR p_Amount <= 0 OR p_Open_Rate IS NULL OR p_Open_Rate <= 0 OR
       p_Trade_Type IS NULL OR
       p_Close_Rate IS NULL OR p_Close_Rate <= 0 OR p_Trade_Type NOT IN ('BUY', 'SELL') THEN
        RETURN NULL;
    END IF;

    RETURN ROUND(
        p_Amount * (p_Close_Rate - p_Open_Rate) / p_Open_Rate *
        IF(p_Trade_Type = 'BUY', 1, -1),
        2
    );
END //

CREATE TRIGGER Prevent_Negative_Balance
BEFORE INSERT ON Payment
FOR EACH ROW
BEGIN
    DECLARE v_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_balance DECIMAL(15, 2) DEFAULT NULL;
    DECLARE v_used_margin DECIMAL(15, 2) DEFAULT NULL;
    DECLARE v_pending DECIMAL(15, 2) DEFAULT 0;

    SELECT Status, Balance INTO v_status, v_balance
    FROM Trading_Account WHERE Account_ID = NEW.Account_ID;
    IF v_status IS NULL OR v_status <> 'Active' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payments require an active trading account.';
    END IF;

    IF NEW.Type = 'WITHDRAWAL' THEN
        SELECT Used_Margin INTO v_used_margin
        FROM Margin_Account WHERE Account_ID = NEW.Account_ID;
        IF v_used_margin IS NULL THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Withdrawal requires a valid margin account.';
        END IF;
        SELECT COALESCE(SUM(Amount), 0) INTO v_pending
        FROM Payment
        WHERE Account_ID = NEW.Account_ID AND Type = 'WITHDRAWAL' AND Status = 'PENDING';
        IF NEW.Status = 'COMPLETED' AND v_balance - v_used_margin < NEW.Amount THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Withdrawal exceeds available balance.';
        END IF;
        IF NEW.Status = 'PENDING' AND v_balance - v_used_margin - v_pending < NEW.Amount THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Withdrawal exceeds available free balance.';
        END IF;
    END IF;
END //

CREATE TRIGGER Prevent_Negative_Balance_Update
BEFORE UPDATE ON Payment
FOR EACH ROW
BEGIN
    DECLARE v_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_balance DECIMAL(15, 2) DEFAULT NULL;
    DECLARE v_used_margin DECIMAL(15, 2) DEFAULT NULL;

    IF NEW.Type = 'WITHDRAWAL' AND NEW.Status = 'COMPLETED' AND OLD.Status <> 'COMPLETED' THEN
        SELECT Status, Balance INTO v_status, v_balance
        FROM Trading_Account WHERE Account_ID = NEW.Account_ID;
        SELECT Used_Margin INTO v_used_margin
        FROM Margin_Account WHERE Account_ID = NEW.Account_ID;
        IF v_status IS NULL OR v_status <> 'Active' OR v_used_margin IS NULL OR
           v_balance - v_used_margin < NEW.Amount THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Withdrawal exceeds available balance or account is inactive.';
        END IF;
    END IF;
END //

CREATE TRIGGER After_Trade_Insert
AFTER INSERT ON Forex_Trade
FOR EACH ROW
BEGIN
    DECLARE v_margin_id INT DEFAULT NULL;
    DECLARE v_leverage DECIMAL(5, 2) DEFAULT NULL;
    DECLARE v_free_margin DECIMAL(15, 2) DEFAULT NULL;
    DECLARE v_balance DECIMAL(15, 2) DEFAULT NULL;
    DECLARE v_required DECIMAL(15, 2);

    IF NEW.Status = 'OPEN' THEN
        SELECT ma.Margin_ID, ma.Leverage, ma.Free_Margin, ta.Balance
        INTO v_margin_id, v_leverage, v_free_margin, v_balance
        FROM Margin_Account ma
        JOIN Trading_Account ta ON ta.Account_ID = ma.Account_ID
        WHERE ma.Account_ID = NEW.Account_ID AND ta.Status = 'Active';

        IF v_margin_id IS NULL OR v_leverage IS NULL OR v_leverage <= 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Active account with a valid margin account is required.';
        END IF;

        SET v_required = ROUND(NEW.Amount / v_leverage, 2);
        IF v_free_margin < v_required THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Insufficient Free Margin to execute trade.';
        END IF;

        UPDATE Margin_Account
        SET Margin_Level = IF(Used_Margin + v_required = 0, 0,
                              v_balance / (Used_Margin + v_required) * 100),
            Used_Margin = Used_Margin + v_required,
        Free_Margin = Free_Margin - v_required
        WHERE Margin_ID = v_margin_id;

        INSERT INTO Margin_Transaction (Margin_ID, Amount, Type)
        VALUES (v_margin_id, v_required, 'RESERVE');
    END IF;
END //

CREATE PROCEDURE ProcessDeposit(
    IN p_Account_ID INT,
    IN p_Broker_ID INT,
    IN p_Amount DECIMAL(15, 2)
)
BEGIN
    DECLARE v_status VARCHAR(20) DEFAULT NULL;
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
    SELECT Status INTO v_status FROM Trading_Account
    WHERE Account_ID = p_Account_ID FOR UPDATE;
    IF v_status IS NULL OR v_status <> 'Active' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Active Trading Account not found.';
    END IF;
    SELECT Margin_ID INTO v_margin_id FROM Margin_Account
    WHERE Account_ID = p_Account_ID FOR UPDATE;
    IF v_margin_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Margin Account not found.';
    END IF;

    UPDATE Trading_Account SET Balance = Balance + p_Amount WHERE Account_ID = p_Account_ID;
    UPDATE Margin_Account
    SET Free_Margin = Free_Margin + p_Amount,
        Margin_Level = IF(Used_Margin = 0, 0, (SELECT Balance FROM Trading_Account WHERE Account_ID = p_Account_ID) / Used_Margin * 100)
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
    DECLARE v_leverage DECIMAL(5, 2) DEFAULT NULL;
    DECLARE v_free_margin DECIMAL(15, 2) DEFAULT NULL;
    DECLARE v_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_required DECIMAL(15, 2);
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
    SELECT Leverage, Free_Margin INTO v_leverage, v_free_margin
    FROM Margin_Account WHERE Account_ID = p_Account_ID FOR UPDATE;
    IF v_leverage IS NULL OR v_leverage <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Valid Margin Account not found.';
    END IF;
    SET v_required = ROUND(p_Amount / v_leverage, 2);
    IF v_free_margin < v_required THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Insufficient Free Margin to execute trade.';
    END IF;

    INSERT INTO Forex_Trade
        (Account_ID, Broker_ID, From_Currency, To_Currency, Amount, Trade_Type, Status, Open_Rate)
    VALUES
        (p_Account_ID, p_Broker_ID, p_From_Currency, p_To_Currency, p_Amount, p_Trade_Type, 'OPEN', v_rate);
    COMMIT;
END //

CREATE PROCEDURE CloseTrade(
    IN p_Trade_ID INT,
    IN p_Account_ID INT
)
BEGIN
    DECLARE v_margin_id INT DEFAULT NULL;
    DECLARE v_amount DECIMAL(15, 2) DEFAULT NULL;
    DECLARE v_open_rate DECIMAL(12, 6) DEFAULT NULL;
    DECLARE v_close_rate DECIMAL(12, 6) DEFAULT NULL;
    DECLARE v_used_margin DECIMAL(15, 2) DEFAULT NULL;
    DECLARE v_leverage DECIMAL(5, 2) DEFAULT NULL;
    DECLARE v_profit_loss DECIMAL(15, 2) DEFAULT NULL;
    DECLARE v_trade_type VARCHAR(10) DEFAULT NULL;
    DECLARE v_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_account_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_from_currency CHAR(3) DEFAULT NULL;
    DECLARE v_to_currency CHAR(3) DEFAULT NULL;
    DECLARE v_balance DECIMAL(15, 2) DEFAULT NULL;
    DECLARE v_release_margin DECIMAL(15, 2) DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;
    SELECT Status INTO v_account_status FROM Trading_Account
    WHERE Account_ID = p_Account_ID FOR UPDATE;
    IF v_account_status IS NULL OR v_account_status <> 'Active' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Active Trading Account not found.';
    END IF;

    SELECT Trade_Type, Amount, Open_Rate, Status, From_Currency, To_Currency
    INTO v_trade_type, v_amount, v_open_rate, v_status, v_from_currency, v_to_currency
    FROM Forex_Trade
    WHERE Trade_ID = p_Trade_ID AND Account_ID = p_Account_ID FOR UPDATE;
    IF v_status IS NULL OR v_status <> 'OPEN' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Open trade not found.';
    END IF;

    SELECT Rate INTO v_close_rate FROM Exchange_Rate
    WHERE From_Currency = v_from_currency AND To_Currency = v_to_currency;
    IF v_close_rate IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Current exchange rate not found for this trade.';
    END IF;

    SELECT Margin_ID, Used_Margin, Leverage INTO v_margin_id, v_used_margin, v_leverage
    FROM Margin_Account WHERE Account_ID = p_Account_ID FOR UPDATE;
    IF v_margin_id IS NULL OR v_used_margin IS NULL OR v_leverage IS NULL OR v_leverage <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Valid Margin Account not found.';
    END IF;
    SET v_profit_loss = CalculateProfitLoss(v_amount, v_open_rate, v_close_rate, v_trade_type);
    IF v_profit_loss IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Unable to calculate trade profit/loss.';
    END IF;

    SET v_release_margin = ROUND(v_amount / v_leverage, 2);
    SELECT Balance + v_profit_loss INTO v_balance
    FROM Trading_Account WHERE Account_ID = p_Account_ID;
    IF v_balance < 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Trade loss would make the account balance negative.';
    END IF;

    UPDATE Forex_Trade SET Status = 'CLOSED', Close_Rate = v_close_rate, Profit_Loss = v_profit_loss
    WHERE Trade_ID = p_Trade_ID;
    UPDATE Trading_Account SET Balance = Balance + v_profit_loss WHERE Account_ID = p_Account_ID;
    UPDATE Margin_Account
    SET Margin_Level = IF(GREATEST(0, Used_Margin - v_release_margin) = 0, 0,
            v_balance / GREATEST(0, Used_Margin - v_release_margin) * 100),
        Used_Margin = GREATEST(0, Used_Margin - v_release_margin),
        Free_Margin = Free_Margin + v_release_margin
    WHERE Margin_ID = v_margin_id;
    INSERT INTO Margin_Transaction (Margin_ID, Amount, Type)
    VALUES (v_margin_id, v_release_margin, 'RELEASE');
    COMMIT;
END //

CREATE PROCEDURE RequestWithdrawal(
    IN p_Account_ID INT,
    IN p_Broker_ID INT,
    IN p_Amount DECIMAL(15, 2)
)
BEGIN
    DECLARE v_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_balance DECIMAL(15, 2) DEFAULT NULL;
    DECLARE v_used_margin DECIMAL(15, 2) DEFAULT NULL;
    DECLARE v_pending DECIMAL(15, 2) DEFAULT 0;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_Amount IS NULL OR p_Amount <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Withdrawal amount must be positive.';
    END IF;
    START TRANSACTION;
    SELECT Status, Balance INTO v_status, v_balance FROM Trading_Account
    WHERE Account_ID = p_Account_ID FOR UPDATE;
    IF v_status IS NULL OR v_status <> 'Active' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Active Trading Account not found.';
    END IF;
    SELECT Used_Margin INTO v_used_margin FROM Margin_Account
    WHERE Account_ID = p_Account_ID FOR UPDATE;
    IF v_used_margin IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Margin Account not found.';
    END IF;
    SELECT COALESCE(SUM(Amount), 0) INTO v_pending FROM Payment
    WHERE Account_ID = p_Account_ID AND Type = 'WITHDRAWAL' AND Status = 'PENDING';
    IF v_balance - v_used_margin - v_pending < p_Amount THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Withdrawal exceeds available free balance.';
    END IF;
    INSERT INTO Payment (Account_ID, Broker_ID, Amount, Type, Status)
    VALUES (p_Account_ID, p_Broker_ID, p_Amount, 'WITHDRAWAL', 'PENDING');
    COMMIT;
END //

CREATE PROCEDURE ReviewWithdrawal(
    IN p_Payment_ID INT,
    IN p_Admin_User_ID INT,
    IN p_Action VARCHAR(10),
    IN p_Note VARCHAR(255)
)
BEGIN
    DECLARE v_account_id INT DEFAULT NULL;
    DECLARE v_amount DECIMAL(15, 2) DEFAULT NULL;
    DECLARE v_type VARCHAR(20) DEFAULT NULL;
    DECLARE v_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_balance DECIMAL(15, 2) DEFAULT NULL;
    DECLARE v_used_margin DECIMAL(15, 2) DEFAULT NULL;
    DECLARE v_margin_id INT DEFAULT NULL;
    DECLARE v_admin_role VARCHAR(20) DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_Action NOT IN ('APPROVE', 'REJECT') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Action must be APPROVE or REJECT.';
    END IF;
    START TRANSACTION;
    SELECT Account_ID INTO v_account_id FROM Payment WHERE Payment_ID = p_Payment_ID;
    IF v_account_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Pending withdrawal not found.';
    END IF;
    SELECT Balance INTO v_balance FROM Trading_Account
    WHERE Account_ID = v_account_id FOR UPDATE;
    SELECT Account_ID, Amount, Type, Status
    INTO v_account_id, v_amount, v_type, v_status
    FROM Payment WHERE Payment_ID = p_Payment_ID FOR UPDATE;
    IF v_status IS NULL OR v_type <> 'WITHDRAWAL' OR v_status <> 'PENDING' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Pending withdrawal not found.';
    END IF;
    SELECT Role INTO v_admin_role FROM User_Account
    WHERE User_ID = p_Admin_User_ID FOR UPDATE;
    IF v_admin_role IS NULL OR v_admin_role <> 'ADMIN' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Withdrawal review requires an administrator.';
    END IF;
    SELECT Margin_ID, Used_Margin INTO v_margin_id, v_used_margin FROM Margin_Account
    WHERE Account_ID = v_account_id FOR UPDATE;
    IF v_margin_id IS NULL OR v_used_margin IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Margin Account not found.';
    END IF;

    IF p_Action = 'APPROVE' THEN
        IF v_balance - v_used_margin < v_amount THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Withdrawal cannot be approved; available balance has changed.';
        END IF;
        UPDATE Payment
        SET Status = 'COMPLETED', Reviewed_By = p_Admin_User_ID, Reviewed_At = CURRENT_TIMESTAMP,
            Review_Note = p_Note
        WHERE Payment_ID = p_Payment_ID;
        UPDATE Trading_Account SET Balance = Balance - v_amount WHERE Account_ID = v_account_id;
        UPDATE Margin_Account
        SET Margin_Level = IF(Used_Margin = 0, 0,
                (SELECT Balance FROM Trading_Account WHERE Account_ID = v_account_id) / Used_Margin * 100),
            Free_Margin = Free_Margin - v_amount
        WHERE Margin_ID = v_margin_id;
    ELSE
        UPDATE Payment
        SET Status = 'FAILED', Reviewed_By = p_Admin_User_ID, Reviewed_At = CURRENT_TIMESTAMP,
            Review_Note = p_Note
        WHERE Payment_ID = p_Payment_ID;
    END IF;
    COMMIT;
END //

DELIMITER ;
