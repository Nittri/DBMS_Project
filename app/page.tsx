"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type User = { userId: number; customerId: number; email: string; role: "CUSTOMER" | "ADMIN" };
type Account = {
  Account_ID: number;
  Account_Type: string;
  Account_Status: string;
  Balance: number;
  Used_Margin: number;
  Free_Margin: number;
  Margin_Level: number;
  Leverage: number;
  Total_Trades: number;
  Total_PnL: number;
};
type Trade = {
  Trade_ID: number;
  From_Currency: string;
  To_Currency: string;
  Amount: number;
  Trade_Type: string;
  Status: string;
  Open_Rate: number;
  Close_Rate: number | null;
  Profit_Loss: number;
  Created_At: string;
};
type Insight = { pair: string; title: string; summary: string; sentiment: string };
type Payment = {
  Payment_ID: number; Account_ID: number; Amount: number; Type: string; Status: string;
  Payment_Date: string; Reviewed_At: string | null; Review_Note: string | null;
};
type PendingPayment = Payment & { Customer_Name: string };
type Rate = { From_Currency: string; To_Currency: string; Rate: number; Updated_At: string; Trade_Count: number };
type RatePoint = { pair: string; rate: number; recordedAt: string };
type MarginTransaction = { Transaction_ID: number; Account_ID: number; Amount: number; Type: string; Created_At: string };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
  } catch {
    throw new Error("Can't reach the app API. Start the server with `npm run dev` and open its local URL.");
  }
  const responseText = await response.text();
  let body: Record<string, unknown> | null = null;
  if (responseText) {
    try {
      const parsed: unknown = JSON.parse(responseText);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    const message = typeof body?.error === "string"
      ? body.error
      : `The server returned an unreadable error (HTTP ${response.status}). Check the terminal running npm run dev.`;
    throw new Error(message);
  }
  if (!body) throw new Error("The server returned an empty response. Check the terminal running npm run dev.");
  return body as T;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [pendingPayments, setPendingPayments] = useState<PendingPayment[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [rateHistory, setRateHistory] = useState<RatePoint[]>([]);
  const [historyAvailable, setHistoryAvailable] = useState(true);
  const [marginTransactions, setMarginTransactions] = useState<MarginTransaction[]>([]);
  const [adminSummary, setAdminSummary] = useState<Record<string, number> | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadDashboard = useCallback(async () => {
    try {
      const current = await request<{ user: User | null }>("/api/session");
      setUser(current.user);
      if (!current.user) return;
      const [accountResult, tradeResult, paymentResult, rateResult, marginResult] = await Promise.all([
        request<{ accounts: Account[] }>("/api/accounts"),
        request<{ trades: Trade[] }>("/api/trades"),
        request<{ payments: Payment[] }>("/api/payments"),
        request<{ rates: Rate[]; history: RatePoint[]; historyAvailable: boolean }>("/api/exchange-rates"),
        request<{ transactions: MarginTransaction[] }>("/api/margin"),
      ]);
      setAccounts(accountResult.accounts);
      setTrades(tradeResult.trades);
      setPayments(paymentResult.payments);
      setRates(rateResult.rates);
      setRateHistory(rateResult.history);
      setHistoryAvailable(rateResult.historyAvailable);
      setMarginTransactions(marginResult.transactions);
      try {
        const insightResult = await request<{ insights: Insight[] }>("/api/insights");
        setInsights(insightResult.insights);
      } catch {
        setInsights([]);
        setMessage("Market notes are unavailable. Start MongoDB using the local setup instructions.");
      }
      if (current.user.role === "ADMIN") {
        const [result, queue] = await Promise.all([
          request<{ summary: Record<string, number> }>("/api/admin/summary"),
          request<{ payments: PendingPayment[] }>("/api/admin/payments"),
        ]);
        setAdminSummary(result.summary);
        setPendingPayments(queue.payments);
      } else {
        setAdminSummary(null);
        setPendingPayments([]);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load dashboard.");
    }
  }, []);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await request(`/api/auth/${mode === "register" ? "register" : "login"}`, {
        method: "POST",
        body: JSON.stringify(values),
      });
      setMessage("");
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAction(event: FormEvent<HTMLFormElement>, endpoint: string, method = "POST") {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setMessage("");
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      const result = await request<{ warning?: string }>(endpoint, { method, body: JSON.stringify(values) });
      setMessage(result.warning ?? "Request completed.");
      form.reset();
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function closeTrade(tradeId: number) {
    setBusy(true);
    setMessage("");
    try {
      await request(`/api/trades/${tradeId}/close`, { method: "POST" });
      setMessage("Trade closed and profit/loss applied.");
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not close trade.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewPayment(paymentId: number, action: "APPROVE" | "REJECT") {
    setBusy(true);
    setMessage("");
    try {
      await request(`/api/admin/payments/${paymentId}`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      setMessage(action === "APPROVE" ? "Withdrawal approved." : "Withdrawal rejected.");
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not review withdrawal.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await request("/api/auth/logout", { method: "POST" });
    setUser(null);
    setAccounts([]);
    setTrades([]);
    setInsights([]);
    setPayments([]);
    setPendingPayments([]);
    setRates([]);
    setRateHistory([]);
    setMarginTransactions([]);
    setAdminSummary(null);
  }

  if (!user) {
    return (
      <main className="auth-layout">
        <section className="hero-panel">
          <div className="brand-mark">FX</div>
          <p className="eyebrow">FOREX TRADING SYSTEM · DBMS PROJECT</p>
          <h1>Markets move.<br />Stay in control.</h1>
          <p className="hero-copy">A secure learning environment for currency trading, margin accounts, and relational data.</p>
          <div className="ticker"><span>USD / INR</span><strong>83.5000</strong><small>Sample rate</small></div>
        </section>
        <section className="auth-panel">
          <div className="auth-card">
            <p className="eyebrow">{mode === "login" ? "WELCOME BACK" : "GET STARTED"}</p>
            <h2>{mode === "login" ? "Sign in to your desk" : "Create your account"}</h2>
            <p className="muted">Use your Forex Desk credentials to continue.</p>
            <form onSubmit={handleAuth} className="form-stack">
              {mode === "register" && <>
                <label>Full name<input name="name" required maxLength={100} autoComplete="name" /></label>
                <label>Phone<input name="phone" required maxLength={20} autoComplete="tel" /></label>
              </>}
              <label>Email address<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
              <label>Password<input name="password" type="password" required minLength={mode === "register" ? 10 : 1} maxLength={128} autoComplete={mode === "register" ? "new-password" : "current-password"} /></label>
              {message && <p className="notice" role="alert">{message}</p>}
              <button className="button primary" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
            </form>
            <p className="switch-mode">{mode === "login" ? "New here?" : "Already have an account?"}{" "}
              <button className="text-button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setMessage(""); }}>
                {mode === "login" ? "Create an account" : "Sign in"}
              </button>
            </p>
          </div>
          <p className="fine-print">Demo project only. Rates and insights are sample data, not financial advice.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <header className="topbar">
        <a className="wordmark" href="#"><span className="brand-mark small">FX</span> Forex Desk</a>
        <div className="user-area"><span className="role-pill">{user.role}</span><span>{user.email}</span><button className="button subtle" onClick={logout}>Sign out</button></div>
      </header>
      <section className="welcome-row">
        <div><p className="eyebrow">TRADING OVERVIEW</p><h1>Your account desk</h1><p className="muted">Monitor your demo balance, margin, and open positions.</p></div>
        <div className="live-tag"><span /> DEMO ENVIRONMENT</div>
      </section>
      {message && <p className="notice dashboard-notice" role="status">{message}</p>}
      <section className="metrics-grid">
        {accounts.map((account) => <div className="metric-card balance-card" key={account.Account_ID}>
          <span className="metric-label">ACCOUNT BALANCE · #{account.Account_ID}</span>
          <strong>${Number(account.Balance).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>
          <small>{account.Account_Type} · {account.Account_Status}</small>
        </div>)}
        {accounts.map((account) => <div className="metric-card" key={`margin-${account.Account_ID}`}>
          <span className="metric-label">FREE MARGIN</span>
          <strong>${Number(account.Free_Margin).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>
          <small>{account.Leverage}:1 leverage · {account.Used_Margin} used · {Number(account.Margin_Level).toFixed(1)}% margin level</small>
        </div>)}
        <div className="metric-card">
          <span className="metric-label">TOTAL TRADES</span>
          <strong>{accounts.reduce((sum, account) => sum + Number(account.Total_Trades), 0)}</strong>
          <small>Across your trading accounts</small>
        </div>
      </section>
      {adminSummary && <section className="panel admin-panel">
        <div className="section-heading"><div><p className="eyebrow">ADMINISTRATION</p><h2>Platform summary</h2></div></div>
        <div className="admin-stats">{Object.entries(adminSummary).map(([label, count]) =>
          <div key={label}><strong>{count}</strong><span>{label.replaceAll("_", " ")}</span></div>)}</div>
      </section>}
      <section className="content-grid">
        <div className="panel">
          <div className="section-heading"><div><p className="eyebrow">EXECUTION</p><h2>Place a demo trade</h2></div><span className="panel-icon">↗</span></div>
          <form className="form-stack compact" onSubmit={(event) => handleAction(event, "/api/trades")}>
            <label>Account<select name="accountId" required>{accounts.map((account) => <option key={account.Account_ID} value={account.Account_ID}>Account #{account.Account_ID}</option>)}</select></label>
            <div className="form-row">
              <label>From<input name="fromCurrency" required pattern="[A-Za-z]{3}" defaultValue="USD" maxLength={3} /></label>
              <label>To<input name="toCurrency" required pattern="[A-Za-z]{3}" defaultValue="INR" maxLength={3} /></label>
            </div>
            <div className="form-row">
              <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label>
              <label>Side<select name="tradeType"><option>BUY</option><option>SELL</option></select></label>
            </div>
            <label>Broker ID<input name="brokerId" type="number" min="1" defaultValue="1" required /></label>
            <button className="button primary" disabled={busy || accounts.length === 0}>Submit demo trade</button>
          </form>
        </div>
        <div className="panel">
          <div className="section-heading"><div><p className="eyebrow">ACCOUNT FUNDING</p><h2>Demo deposit</h2></div><span className="panel-icon">＋</span></div>
          <p className="muted">Adds simulated funds to your balance and free margin.</p>
          <form className="form-stack compact" onSubmit={(event) => handleAction(event, "/api/payments/deposit")}>
            <label>Account<select name="accountId" required>{accounts.map((account) => <option key={account.Account_ID} value={account.Account_ID}>Account #{account.Account_ID}</option>)}</select></label>
            <label>Amount<input name="amount" type="number" min="0.01" max="1000000" step="0.01" required /></label>
            <button className="button secondary" disabled={busy || accounts.length === 0}>Add demo funds</button>
          </form>
        </div>
      </section>
      <section className="content-grid lower-grid">
        <div className="panel table-panel">
          <div className="section-heading"><div><p className="eyebrow">ACCOUNT FUNDING</p><h2>Request a withdrawal</h2></div></div>
          <p className="muted">Funds are deducted only after approval. Available balance is checked again during review.</p>
          <form className="form-stack compact" onSubmit={(event) => handleAction(event, "/api/payments")}>
            <label>Account<select name="accountId" required>{accounts.map((account) => <option key={account.Account_ID} value={account.Account_ID}>Account #{account.Account_ID}</option>)}</select></label>
            <label>Amount<input name="amount" type="number" min="0.01" max="1000000" step="0.01" required /></label>
            <button className="button secondary" disabled={busy || accounts.length === 0}>Submit withdrawal request</button>
          </form>
        </div>
        <div className="panel table-panel">
          <div className="section-heading"><div><p className="eyebrow">MARGIN ACTIVITY</p><h2>Recent margin transactions</h2></div></div>
          {marginTransactions.length === 0 ? <p className="empty-state">No margin activity yet.</p> :
            <div className="table-scroll"><table><thead><tr><th>Account</th><th>Type</th><th>Amount</th><th>Date</th></tr></thead>
              <tbody>{marginTransactions.slice(0, 8).map((transaction) => <tr key={transaction.Transaction_ID}>
                <td>#{transaction.Account_ID}</td><td>{transaction.Type}</td><td>${Number(transaction.Amount).toFixed(2)}</td><td>{new Date(transaction.Created_At).toLocaleDateString()}</td>
              </tr>)}</tbody></table></div>}
        </div>
      </section>
      <section className="panel table-panel panel-spaced">
        <div className="section-heading"><div><p className="eyebrow">ACTIVITY</p><h2>Payment history</h2></div><span className="subtle-count">{payments.length} shown</span></div>
        {payments.length === 0 ? <p className="empty-state">No payments or withdrawal requests yet.</p> :
          <div className="table-scroll"><table><thead><tr><th>Type</th><th>Amount</th><th>Status</th><th>Requested</th><th>Review note</th></tr></thead>
            <tbody>{payments.map((payment) => <tr key={payment.Payment_ID}>
              <td>{payment.Type}</td><td>${Number(payment.Amount).toFixed(2)}</td><td>{payment.Status}</td>
              <td>{new Date(payment.Payment_Date).toLocaleString()}</td><td>{payment.Review_Note ?? "—"}</td>
            </tr>)}</tbody></table></div>}
      </section>
      {user.role === "ADMIN" && <section className="content-grid lower-grid">
        <div className="panel table-panel">
          <div className="section-heading"><div><p className="eyebrow">BROKER OPERATIONS</p><h2>Manage exchange rates</h2></div></div>
          <form className="form-stack compact" onSubmit={(event) => handleAction(event, "/api/exchange-rates", "PUT")}>
            <div className="form-row">
              <label>From currency<input name="fromCurrency" required pattern="[A-Za-z]{3}" maxLength={3} defaultValue="USD" /></label>
              <label>To currency<input name="toCurrency" required pattern="[A-Za-z]{3}" maxLength={3} defaultValue="INR" /></label>
            </div>
            <label>Demo rate<input name="rate" type="number" min="0.000001" step="0.000001" required /></label>
            <button className="button primary" disabled={busy}>Save rate</button>
          </form>
          <div className="table-scroll panel-spaced"><table><thead><tr><th>Pair</th><th>Rate</th><th>Trades</th><th>Updated</th></tr></thead>
            <tbody>{rates.map((rate) => <tr key={`${rate.From_Currency}/${rate.To_Currency}`}>
              <td>{rate.From_Currency}/{rate.To_Currency}</td><td>{Number(rate.Rate).toFixed(6)}</td>
              <td>{rate.Trade_Count}</td><td>{new Date(rate.Updated_At).toLocaleString()}</td>
            </tr>)}</tbody></table></div>
          <div className="panel-spaced">
            <div className="section-heading"><div><p className="eyebrow">MONGODB · DAILY AGGREGATION · 30 DAYS</p><h2>Rate history</h2></div></div>
            {!historyAvailable ? <p className="muted">MongoDB history is unavailable; current MySQL rates are still shown.</p> :
              rateHistory.length === 0 ? <p className="muted">No rate changes recorded yet. Saving a rate creates the first history point.</p> :
                <div className="table-scroll"><table><thead><tr><th>Pair</th><th>Daily rate</th><th>Date</th></tr></thead>
                  <tbody>{rateHistory.map((point, index) => <tr key={`${point.pair}-${point.recordedAt}-${index}`}>
                    <td>{point.pair}</td><td>{Number(point.rate).toFixed(6)}</td><td>{new Date(point.recordedAt).toLocaleDateString()}</td>
                  </tr>)}</tbody></table></div>}
          </div>
        </div>
        <div className="panel table-panel">
          <div className="section-heading"><div><p className="eyebrow">REVIEW QUEUE</p><h2>Pending withdrawals</h2></div><span className="subtle-count">{pendingPayments.length} pending</span></div>
          {pendingPayments.length === 0 ? <p className="empty-state">No withdrawals awaiting review.</p> :
            <div className="table-scroll"><table><thead><tr><th>Customer</th><th>Account</th><th>Amount</th><th>Action</th></tr></thead>
              <tbody>{pendingPayments.map((payment) => <tr key={payment.Payment_ID}>
                <td>{payment.Customer_Name}</td><td>#{payment.Account_ID}</td><td>${Number(payment.Amount).toFixed(2)}</td>
                <td><div className="review-actions">
                  <button className="button secondary" disabled={busy} onClick={() => void reviewPayment(payment.Payment_ID, "APPROVE")}>Approve</button>
                  <button className="button subtle" disabled={busy} onClick={() => void reviewPayment(payment.Payment_ID, "REJECT")}>Reject</button>
                </div></td>
              </tr>)}</tbody></table></div>}
        </div>
      </section>}
      <section className="content-grid lower-grid">
        <div className="panel table-panel">
          <div className="section-heading"><div><p className="eyebrow">PORTFOLIO</p><h2>Recent trades</h2></div><span className="subtle-count">{trades.length} shown</span></div>
          {trades.length === 0 ? <p className="empty-state">Your demo trades will appear here.</p> :
            <div className="table-scroll"><table><thead><tr><th>Pair</th><th>Side</th><th>Amount</th><th>Open rate</th><th>Status</th><th>P/L</th><th></th></tr></thead>
              <tbody>{trades.map((trade) => <tr key={trade.Trade_ID}>
                <td>{trade.From_Currency}/{trade.To_Currency}</td><td><span className={`trade-side ${trade.Trade_Type.toLowerCase()}`}>{trade.Trade_Type}</span></td>
                <td>{Number(trade.Amount).toLocaleString()}</td><td>{Number(trade.Open_Rate).toFixed(4)}</td><td>{trade.Status}</td>
                <td>{trade.Status === "CLOSED" ? `$${Number(trade.Profit_Loss).toFixed(2)}` : "—"}</td>
                <td>{trade.Status === "OPEN" && <button className="button subtle" disabled={busy} onClick={() => void closeTrade(trade.Trade_ID)}>Close</button>}</td>
              </tr>)}</tbody></table></div>}
        </div>
        <div className="panel">
          <div className="section-heading"><div><p className="eyebrow">MONGODB · SAMPLE DOCUMENTS</p><h2>Market notes</h2></div></div>
          <div className="insight-list">{insights.map((insight, index) => <article className="insight" key={`${insight.pair}-${index}`}>
            <div className="insight-top"><strong>{insight.pair}</strong><span className="neutral-dot">● {insight.sentiment}</span></div>
            <h3>{insight.title}</h3><p>{insight.summary}</p>
          </article>)}</div>
        </div>
      </section>
      <footer className="footer-note">Learning project · Sample data only · Not financial advice</footer>
    </main>
  );
}
