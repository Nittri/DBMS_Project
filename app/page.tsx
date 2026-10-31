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
  Created_At: string;
};
type Insight = { pair: string; title: string; summary: string; sentiment: string };

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
  const [adminSummary, setAdminSummary] = useState<Record<string, number> | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadDashboard = useCallback(async () => {
    try {
      const current = await request<{ user: User | null }>("/api/session");
      setUser(current.user);
      if (!current.user) return;
      const [accountResult, tradeResult] = await Promise.all([
        request<{ accounts: Account[] }>("/api/accounts"),
        request<{ trades: Trade[] }>("/api/trades"),
      ]);
      setAccounts(accountResult.accounts);
      setTrades(tradeResult.trades);
      try {
        const insightResult = await request<{ insights: Insight[] }>("/api/insights");
        setInsights(insightResult.insights);
      } catch {
        setInsights([]);
        setMessage("Market notes are unavailable. Start MongoDB using the local setup instructions.");
      }
      if (current.user.role === "ADMIN") {
        const result = await request<{ summary: Record<string, number> }>("/api/admin/summary");
        setAdminSummary(result.summary);
      } else {
        setAdminSummary(null);
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

  async function handleAction(event: FormEvent<HTMLFormElement>, endpoint: string) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setMessage("");
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      await request(endpoint, { method: "POST", body: JSON.stringify(values) });
      setMessage("Request completed.");
      form.reset();
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
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
          <small>{account.Leverage}:1 leverage · {account.Used_Margin} used</small>
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
          <div key={label}><strong>{count}</strong><span>{label}</span></div>)}</div>
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
          <div className="section-heading"><div><p className="eyebrow">PORTFOLIO</p><h2>Recent trades</h2></div><span className="subtle-count">{trades.length} shown</span></div>
          {trades.length === 0 ? <p className="empty-state">Your demo trades will appear here.</p> :
            <div className="table-scroll"><table><thead><tr><th>Pair</th><th>Side</th><th>Amount</th><th>Open rate</th><th>Status</th></tr></thead>
              <tbody>{trades.map((trade) => <tr key={trade.Trade_ID}>
                <td>{trade.From_Currency}/{trade.To_Currency}</td><td><span className={`trade-side ${trade.Trade_Type.toLowerCase()}`}>{trade.Trade_Type}</span></td>
                <td>{Number(trade.Amount).toLocaleString()}</td><td>{Number(trade.Open_Rate).toFixed(4)}</td><td>{trade.Status}</td>
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
