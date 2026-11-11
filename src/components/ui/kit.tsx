"use client";

import type { CSSProperties, ReactNode } from "react";

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <article className={`mm-card ${padded ? "p-5" : ""} ${className}`}>{children}</article>;
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent" | "info";
}) {
  const map: Record<string, string> = {
    neutral: "border-[var(--mm-border)] text-[var(--mm-muted)] bg-[var(--mm-subtle)]",
    success: "border-emerald-200/80 text-emerald-700 bg-emerald-50 dark-tone",
    warning: "border-amber-200/80 text-amber-800 bg-amber-50",
    danger: "border-rose-200/80 text-rose-700 bg-rose-50",
    accent: "border-transparent text-white",
    info: "border-sky-200/80 text-sky-800 bg-sky-50",
  };
  const style =
    tone === "accent"
      ? { background: "linear-gradient(135deg,var(--mm-accent),var(--mm-accent-2))" }
      : tone === "success"
        ? { background: "color-mix(in srgb, var(--mm-success) 12%, var(--mm-surface))", color: "var(--mm-success)", borderColor: "color-mix(in srgb, var(--mm-success) 28%, var(--mm-border))" }
        : tone === "warning"
          ? { background: "color-mix(in srgb, var(--mm-warning) 12%, var(--mm-surface))", color: "var(--mm-warning)", borderColor: "color-mix(in srgb, var(--mm-warning) 28%, var(--mm-border))" }
          : tone === "danger"
            ? { background: "color-mix(in srgb, var(--mm-danger) 12%, var(--mm-surface))", color: "var(--mm-danger)", borderColor: "color-mix(in srgb, var(--mm-danger) 28%, var(--mm-border))" }
            : tone === "info"
              ? { background: "color-mix(in srgb, var(--mm-cyan) 12%, var(--mm-surface))", color: "var(--mm-cyan)", borderColor: "color-mix(in srgb, var(--mm-cyan) 28%, var(--mm-border))" }
              : undefined;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${tone === "accent" ? "border-transparent text-white" : map[tone]}`}
      style={style}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  href,
  variant = "primary",
  disabled,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const base =
    "mm-focus inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium disabled:opacity-50";
  const styles: Record<string, { className: string; style?: CSSProperties }> = {
    primary: {
      className: "text-white shadow-sm",
      style: { background: "linear-gradient(135deg,var(--mm-accent),var(--mm-accent-2))" },
    },
    secondary: {
      className: "border border-[var(--mm-border)] bg-[var(--mm-surface)] text-[var(--mm-ink)]",
    },
    ghost: {
      className: "text-[var(--mm-muted)] hover:text-[var(--mm-ink)]",
    },
    danger: {
      className: "border text-white",
      style: { background: "var(--mm-danger)", borderColor: "var(--mm-danger)" },
    },
  };
  const s = styles[variant];
  if (href) {
    return (
      <a href={href} className={`${base} ${s.className} ${className}`} style={s.style}>
        {children}
      </a>
    );
  }
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={`${base} ${s.className} ${className}`} style={s.style}>
      {children}
    </button>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  icon,
  trend,
  trendUp,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
  trend?: string;
  trendUp?: boolean;
}) {
  return (
    <Card className="min-w-0">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--mm-muted)]">{label}</p>
        {icon && (
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
            style={{ background: "linear-gradient(135deg,var(--mm-accent),var(--mm-accent-2))" }}
          >
            {icon}
          </span>
        )}
      </div>
      <p className="mt-2 truncate font-display text-2xl font-semibold tabular tracking-tight text-[var(--mm-ink)]">{value}</p>
      {trend && (
        <p className={`mt-1 text-xs font-medium ${trendUp ? "text-[var(--mm-success)]" : "text-[var(--mm-danger)]"}`}>{trend}</p>
      )}
      {hint && <p className="mt-1 text-[11px] text-[var(--mm-muted)]">{hint}</p>}
    </Card>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onCancel} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="mm-card mm-slide-up w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-lg font-semibold text-[var(--mm-ink)]">
          {title}
        </h2>
        <p className="mt-2 text-sm text-[var(--mm-muted)]">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Donut({
  percent,
  label,
  sub,
  size = 148,
}: {
  percent: number;
  label: string;
  sub?: string;
  size?: number;
}) {
  const p = Math.max(0, Math.min(100, percent));
  const r = 54;
  const c = 2 * Math.PI * r;
  const dash = (p / 100) * c;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--mm-border)" strokeWidth="14" />
        <circle
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke="url(#donutGrad)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
        />
        <defs>
          <linearGradient id="donutGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--mm-accent)" />
            <stop offset="100%" stopColor="var(--mm-accent-2)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-2xl font-semibold tabular">{p}%</span>
        <span className="text-[11px] text-[var(--mm-muted)]">{label}</span>
        {sub && <span className="text-[10px] text-[var(--mm-muted)]">{sub}</span>}
      </div>
    </div>
  );
}

function monotonePath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M ${pts[0].x} ${pts[0].y}`;
  if (n === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;

  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    m[i] = dx[i] === 0 ? 0 : dy / dx[i];
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  }
  t[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      t[i] = tau * a * m[i];
      t[i + 1] = tau * b * m[i];
    }
  }
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const x0 = pts[i].x;
    const y0 = pts[i].y;
    const x1 = pts[i + 1].x;
    const y1 = pts[i + 1].y;
    const cpx1 = x0 + dx[i] / 3;
    const cpy1 = y0 + (t[i] * dx[i]) / 3;
    const cpx2 = x1 - dx[i] / 3;
    const cpy2 = y1 - (t[i + 1] * dx[i]) / 3;
    d += ` C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${x1} ${y1}`;
  }
  return d;
}

export function LineChart({
  series,
  height = 180,
}: {
  series: { name: string; color: string; points: number[] }[];
  height?: number;
}) {
  const w = 560;
  const h = height;
  const pad = 28;
  const all = series.flatMap((s) => s.points);
  const max = Math.max(1, ...all);
  const toPts = (values: number[]) =>
    values.map((v, i) => ({
      x: pad + (i / Math.max(1, values.length - 1)) * (w - pad * 2),
      y: h - pad - (v / max) * (h - pad * 2),
    }));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label="Spending overview chart">
      {[0, 0.5, 1].map((t) => {
        const y = h - pad - t * (h - pad * 2);
        return <line key={t} x1={pad} x2={w - pad} y1={y} y2={y} stroke="var(--mm-border)" strokeDasharray="4 6" />;
      })}
      {series.map((s) => (
        <path key={s.name} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" d={monotonePath(toPts(s.points))} />
      ))}
    </svg>
  );
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  const over = value > max;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--mm-border)]">
      <div
        className="h-full rounded-full"
        style={{
          width: `${pct}%`,
          background: over ? "var(--mm-danger)" : "linear-gradient(90deg,var(--mm-accent),var(--mm-accent-2))",
        }}
      />
    </div>
  );
}

export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id="agentpalLogoGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--mm-accent)" />
          <stop offset="100%" stopColor="var(--mm-accent-2)" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill="url(#agentpalLogoGrad)" />
      <path
        fill="white"
        fillRule="evenodd"
        d="M20 8.5 L33 31.5 H28.1 L25.55 26.2 H14.45 L11.9 31.5 H7 L20 8.5zm0 6.9 L16.15 23.4 h7.7 L20 15.4z"
      />
    </svg>
  );
}

export function RobotMascot({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 160" className={className} role="img" aria-label="AgentPaL assistant mascot">
      <defs>
        <linearGradient id="botBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#dbe7ff" />
        </linearGradient>
      </defs>
      <circle cx="80" cy="80" r="70" fill="url(#botBody)" opacity="0.15" />
      <rect x="36" y="44" width="88" height="78" rx="28" fill="url(#botBody)" stroke="#c7d4f0" strokeWidth="2" />
      <rect x="74" y="24" width="12" height="22" rx="6" fill="#e8eefc" />
      <circle cx="80" cy="22" r="8" fill="var(--mm-accent-2)" />
      <circle cx="62" cy="80" r="10" fill="#1e293b" />
      <circle cx="98" cy="80" r="10" fill="#1e293b" />
      <circle cx="65" cy="77" r="3" fill="white" />
      <circle cx="101" cy="77" r="3" fill="white" />
      <rect x="68" y="100" width="24" height="6" rx="3" fill="var(--mm-accent)" />
      <rect x="22" y="70" width="16" height="10" rx="5" fill="#e8eefc" />
      <rect x="122" y="70" width="16" height="10" rx="5" fill="#e8eefc" />
    </svg>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--mm-border)] px-4 py-8 text-center">
      <p className="font-medium text-[var(--mm-ink)]">{title}</p>
      <p className="mt-1 text-sm text-[var(--mm-muted)]">{body}</p>
    </div>
  );
}
