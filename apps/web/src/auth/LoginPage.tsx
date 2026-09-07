import { useState, type FormEvent } from "react";

interface LoginPageProps {
  busy: boolean;
  error: string | null;
  rememberPassword: boolean;
  onSubmit: (password: string) => void;
  onRememberPasswordChange: (value: boolean) => void;
}

export function LoginPage({ busy, error, rememberPassword, onSubmit, onRememberPasswordChange }: LoginPageProps) {
  const [password, setPassword] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password) return;
    onSubmit(password);
  }

  return (
    <main className="app-shell login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand-line"><span className="brand-paw brand-paw--rose" aria-hidden="true">●</span><strong>CPE 花花</strong><i>H168-383</i></div>
        <p className="eyebrow">Local device access</p>
        <h1 id="login-title">登录 H168</h1>
        <p className="lede">输入设备管理密码后进入概览。认证成功会立即开始本地实时抓取。</p>
        <form onSubmit={submit}>
          <label className="input-label" htmlFor="device-password">管理密码</label>
          <input
            id="device-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            autoFocus
            placeholder="输入 H168 管理密码"
            disabled={busy}
          />
          <label className="remember-row">
            <input type="checkbox" checked={rememberPassword} onChange={(event) => onRememberPasswordChange(event.target.checked)} disabled={busy} />
            <span><strong>记住密码并自动登录</strong><small>密码只由本地 Surge Bridge 保存，不写入网页存储。</small></span>
          </label>
          {error && <p className="action-error" role="alert">{error}</p>}
          <button className="primary-button full-button" type="submit" disabled={busy || password.length === 0}>
            {busy ? "正在验证…" : "登录并进入概览"}
          </button>
        </form>
        <p className="login-note">请确认 iPhone 已连接 H168 Wi-Fi，且 Surge Module 正在接管本地 Bridge。</p>
      </section>
    </main>
  );
}
