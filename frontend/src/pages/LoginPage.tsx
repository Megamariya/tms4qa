import { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../api/client";
import "./LoginPage.css";

export const LOGIN_CFG_KEY = "tms_login_page_cfg";
export const LOGIN_IMG_KEY = "tms_login_page_img";
export type LoginPageCfg = {
  showImage: boolean;
  imagePosition: "left" | "right";
  showCredentials: "all" | "demo" | "none";
  customImageBase64?: string | null;
};
export const defaultLoginCfg: LoginPageCfg = {
  showImage: true,
  imagePosition: "right",
  showCredentials: "demo",
  customImageBase64: null,
};
export function getLoginCfg(): LoginPageCfg {
  try {
    const s = localStorage.getItem(LOGIN_CFG_KEY);
    return s ? { ...defaultLoginCfg, ...JSON.parse(s) } : defaultLoginCfg;
  } catch {
    return defaultLoginCfg;
  }
}

function LoginIllustration() {
  return (
    <svg viewBox="0 0 480 560" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id="illBg" x1="0" y1="0" x2="480" y2="560" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4f46e5" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="480" height="560" fill="url(#illBg)" />
      {/* decorative bg circles */}
      <circle cx="420" cy="490" r="130" fill="white" fillOpacity="0.04" />
      <circle cx="420" cy="490" r="80"  fill="white" fillOpacity="0.04" />
      <circle cx="60"  cy="90"  r="90"  fill="white" fillOpacity="0.04" />
      {/* Card 1 — Test Suite list */}
      <rect x="48" y="58"  width="224" height="158" rx="14" fill="white" fillOpacity="0.12" />
      <rect x="64" y="76"  width="96"  height="9"   rx="4.5" fill="white" fillOpacity="0.8"  />
      <rect x="64" y="98"  width="12"  height="12"  rx="3"   fill="#4ade80" />
      <rect x="84" y="100" width="134" height="7"   rx="3.5" fill="white" fillOpacity="0.6"  />
      <rect x="64" y="120" width="12"  height="12"  rx="3"   fill="#4ade80" />
      <rect x="84" y="122" width="104" height="7"   rx="3.5" fill="white" fillOpacity="0.6"  />
      <rect x="64" y="142" width="12"  height="12"  rx="3"   fill="#fbbf24" />
      <rect x="84" y="144" width="150" height="7"   rx="3.5" fill="white" fillOpacity="0.6"  />
      <rect x="64" y="164" width="12"  height="12"  rx="3"   fill="#f87171" />
      <rect x="84" y="166" width="114" height="7"   rx="3.5" fill="white" fillOpacity="0.6"  />
      <rect x="64" y="186" width="12"  height="12"  rx="3"   fill="#4ade80" />
      <rect x="84" y="188" width="124" height="7"   rx="3.5" fill="white" fillOpacity="0.6"  />
      {/* Card 2 — Progress bars */}
      <rect x="48" y="240" width="224" height="132" rx="14" fill="white" fillOpacity="0.12" />
      <rect x="64" y="258" width="78"  height="9"   rx="4.5" fill="white" fillOpacity="0.8"  />
      <rect x="64" y="280" width="198" height="9"   rx="4.5" fill="white" fillOpacity="0.15" />
      <rect x="64" y="280" width="164" height="9"   rx="4.5" fill="#4ade80" />
      <rect x="64" y="299" width="198" height="9"   rx="4.5" fill="white" fillOpacity="0.15" />
      <rect x="64" y="299" width="108" height="9"   rx="4.5" fill="#60a5fa" />
      <rect x="64" y="318" width="198" height="9"   rx="4.5" fill="white" fillOpacity="0.15" />
      <rect x="64" y="318" width="48"  height="9"   rx="4.5" fill="#f87171" />
      {/* Card 3 — Pass rate */}
      <rect x="300" y="42" width="164" height="104" rx="14" fill="white" fillOpacity="0.12" />
      <rect x="316" y="60" width="72"  height="9"   rx="4.5" fill="white" fillOpacity="0.8"  />
      <text x="316" y="122" fontFamily="system-ui, sans-serif" fontSize="38" fontWeight="800" fill="white" fillOpacity="0.92">87%</text>
      {/* Card 4 — Run status */}
      <rect x="300" y="166" width="164" height="96"  rx="14" fill="white" fillOpacity="0.12" />
      <rect x="316" y="184" width="88"  height="9"   rx="4.5" fill="white" fillOpacity="0.8"  />
      <rect x="316" y="206" width="24"  height="24"  rx="6"   fill="#4ade80" fillOpacity="0.9" />
      <rect x="348" y="210" width="66"  height="6"   rx="3"   fill="white" fillOpacity="0.6"  />
      <rect x="348" y="221" width="46"  height="5"   rx="2.5" fill="white" fillOpacity="0.35" />
      {/* Card 5 — Sparkline chart */}
      <rect x="300" y="282" width="164" height="112" rx="14" fill="white" fillOpacity="0.12" />
      <rect x="316" y="300" width="62"  height="9"   rx="4.5" fill="white" fillOpacity="0.8"  />
      <polyline
        points="316,358 335,344 354,352 373,333 392,323 411,337 430,318 444,328"
        stroke="white" strokeOpacity="0.75" strokeWidth="2.5"
        fill="none" strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx="444" cy="328" r="4" fill="white" fillOpacity="0.9" />
      {/* Tag chips */}
      <rect x="48" y="398" width="90"  height="28" rx="14" fill="white" fillOpacity="0.16" />
      <rect x="146" y="398" width="110" height="28" rx="14" fill="white" fillOpacity="0.12" />
      <rect x="264" y="398" width="78"  height="28" rx="14" fill="white" fillOpacity="0.12" />
      <rect x="350" y="398" width="66"  height="28" rx="14" fill="white" fillOpacity="0.12" />
      <rect x="48" y="436" width="68"  height="24" rx="12" fill="white" fillOpacity="0.09" />
      <rect x="124" y="436" width="94"  height="24" rx="12" fill="white" fillOpacity="0.09" />
      <rect x="226" y="436" width="60"  height="24" rx="12" fill="white" fillOpacity="0.09" />
      {/* Brand footer */}
      <text x="48" y="506" fontFamily="system-ui, sans-serif" fontSize="26" fontWeight="800" fill="white" fillOpacity="0.92">4QA</text>
      <text x="48" y="528" fontFamily="system-ui, sans-serif" fontSize="13" fontWeight="400" fill="white" fillOpacity="0.55">Test Management System</text>
    </svg>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [login, setLogin]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const cfg = getLoginCfg();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!login.trim() || !password) return;
    setError(null);
    setLoading(true);
    try {
      await authApi.login(login.trim(), password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
    } finally {
      setLoading(false);
    }
  };

  const credBlock = cfg.showCredentials !== "none" && (
    <div className="login-footer">
      {(cfg.showCredentials === "all") && (
        <p>Super Admin: <code>admin@system.local</code> / <code>Admin123!</code></p>
      )}
      <p>Demo Owner: <code>owner@demo.local</code> / <code>Demo123!</code></p>
    </div>
  );

  const formCard = (
    <div className="login-card">
      <div className="login-logo">
        <span className="login-logo-q">4</span>
        <span className="login-logo-qa">QA</span>
      </div>
      <h1 className="login-title">Вход в систему</h1>
      <p className="login-subtitle">Test Management System</p>

      <form className="login-form" onSubmit={submit} autoComplete="off">
        <div className="login-field">
          <label className="login-label">Email или имя пользователя</label>
          <input
            className="input login-input"
            type="text"
            autoFocus
            placeholder="admin@system.local"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="login-field">
          <label className="login-label">Пароль</label>
          <input
            className="input login-input"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />
        </div>

        {error && <div className="login-error">{error}</div>}

        <button
          className="btn btn-primary login-submit"
          type="submit"
          disabled={loading || !login.trim() || !password}
        >
          {loading ? "Входим…" : "Войти"}
        </button>
      </form>

      {credBlock}
    </div>
  );

  if (!cfg.showImage) {
    return (
      <div className="login-page">
        {formCard}
      </div>
    );
  }

  const illusPanel = (
    <div className="login-illus">
      {cfg.customImageBase64
        ? <img src={cfg.customImageBase64} alt="Login illustration" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        : <LoginIllustration />}
    </div>
  );

  return (
    <div className={`login-page login-page--split login-page--img-${cfg.imagePosition}`}>
      {cfg.imagePosition === "left" && illusPanel}
      <div className="login-card-wrap">{formCard}</div>
      {cfg.imagePosition === "right" && illusPanel}
    </div>
  );
}
