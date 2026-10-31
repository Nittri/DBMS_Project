USE forex_db;

-- Customer portfolio and margin health.
SELECT Customer_ID, Customer_Name, Account_ID, Balance, Used_Margin, Free_Margin,
       Margin_Level, Total_Trades, Total_PnL
FROM View_Customer_Trade_Summary
WHERE Customer_ID = 1
ORDER BY Account_ID;

-- Open positions with the latest maintained pair rate.
SELECT ft.Trade_ID, ft.Account_ID, ft.From_Currency, ft.To_Currency,
       ft.Trade_Type, ft.Amount, ft.Open_Rate, er.Rate AS Current_Rate,
       ft.Created_At
FROM Forex_Trade ft
JOIN Exchange_Rate er
  ON er.From_Currency = ft.From_Currency
 AND er.To_Currency = ft.To_Currency
WHERE ft.Status = 'OPEN'
ORDER BY ft.Created_At DESC;

-- Pending withdrawals for the administrator review queue.
SELECT p.Payment_ID, p.Account_ID, c.Name AS Customer_Name, p.Amount, p.Payment_Date
FROM Payment p
JOIN Trading_Account ta ON ta.Account_ID = p.Account_ID
JOIN Customer c ON c.Customer_ID = ta.Customer_ID
WHERE p.Type = 'WITHDRAWAL' AND p.Status = 'PENDING'
ORDER BY p.Payment_Date;

-- Broker workload and traded notional.
SELECT b.Broker_ID, b.Name, b.Commission_Rate,
       COUNT(ft.Trade_ID) AS Trade_Count,
       COALESCE(SUM(ft.Amount), 0) AS Traded_Notional
FROM Broker b
LEFT JOIN Forex_Trade ft ON ft.Broker_ID = b.Broker_ID
GROUP BY b.Broker_ID, b.Name, b.Commission_Rate
ORDER BY Trade_Count DESC;
