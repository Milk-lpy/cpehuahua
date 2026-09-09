import { useState, type FormEvent } from "react";
import type { ColorTheme } from "../live/theme";
import { ThemeToggle } from "../ui/ThemeToggle";

interface LoginPageProps {
  busy: boolean;
  error: string | null;
  rememberPassword: boolean;
  autoLogin: boolean;
  theme: ColorTheme;
  onSubmit: (password: string) => void;
  onRememberPasswordChange: (value: boolean) => void;
  onAutoLoginChange: (value: boolean) => void;
  onThemeChange: (theme: ColorTheme) => void;
}

export function LoginPage({ busy, error, rememberPassword, autoLogin, theme, onSubmit, onRememberPasswordChange, onAutoLoginChange, onThemeChange }: LoginPageProps) {
  const [password, setPassword] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password && !rememberPassword) return;
    onSubmit(password);
  }

  return (
    <main className="app-shell login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand-line"><span className="brand-paw brand-paw--rose" aria-hidden="true">●</span><strong>CPE 花花</strong><i>H168-383</i><ThemeToggle theme={theme} onChange={onThemeChange} /></div>
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
            placeholder={rememberPassword ? "已保存密码，可直接登录" : "输入 H168 管理密码"}
            disabled={busy}
          />
          <label className="remember-row">
            <input type="checkbox" checked={rememberPassword} onChange={(event) => onRememberPasswordChange(event.target.checked)} disabled={busy} />
            <span><strong>记住密码</strong><small>密码只由本地 Surge Bridge 保存，不写入网页存储。</small></span>
          </label>
          <label className="remember-row">
            <input type="checkbox" checked={autoLogin} onChange={(event) => onAutoLoginChange(event.target.checked)} disabled={busy || !rememberPassword} />
            <span><strong>自动登录</strong><small>下次打开页面后自动验证，并立即进入实时概览。</small></span>
          </label>
          {error && <p className="action-error" role="alert">{error}</p>}
          <button className="primary-button full-button" type="submit" disabled={busy || (!rememberPassword && password.length === 0)}>
            {busy ? "正在验证…" : rememberPassword && password.length === 0 ? "使用已保存密码登录" : "登录并进入概览"}
          </button>
        </form>
        <p className="login-note">请确认 iPhone 已连接 H168 Wi-Fi，且 Surge Module 正在接管本地 Bridge。</p>
      </section>
    </main>
  );
}
