/**
 * Core UI primitives on the official UAE Design System classes
 * (@aegov/design-system): aegov-btn, aegov-form-control, aegov-badge,
 * aegov-alert, aegov-card, aegov-toggle, aegov-check-item, aegov-avatar...
 */
import React, { forwardRef, useId } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle, Inbox, RefreshCw } from "lucide-react";
import { cn } from "../../lib/cn";
import { usePrefs } from "../../lib/prefs";

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "outline" | "soft" | "link" | "danger" | "ghost";
export type ButtonSize = "xs" | "sm" | "base" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  iconEnd?: React.ReactNode;
  block?: boolean;
  iconOnly?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "sm", loading, icon, iconEnd, block, iconOnly, className, children, disabled, type = "button", ...rest },
  ref
) {
  const variantClass = {
    primary: "",
    secondary: "btn-secondary",
    outline: "btn-outline",
    soft: "btn-soft",
    link: "btn-link",
    danger: "!bg-aered-600 hover:!bg-aered-700 !text-white !ring-aered-600",
    ghost: "btn-link !no-underline hover:!bg-aeblack-50",
  }[variant];
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "aegov-btn",
        variantClass,
        size !== "base" && `btn-${size}`,
        block && "btn-block",
        iconOnly && "btn-icon",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
      {iconEnd}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

interface FieldProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  size?: "sm" | "base" | "lg";
  children: (id: string) => React.ReactNode;
}

export const Field: React.FC<FieldProps> = ({ label, hint, error, required, className, size = "base", children }) => {
  const id = useId();
  return (
    <div className={cn("aegov-form-control", size !== "base" && `control-${size}`, error && "control-error", className)}>
      {label && (
        <label htmlFor={id}>
          {label}
          {required && <span className="text-aered-600 ms-0.5">*</span>}
        </label>
      )}
      {children(id)}
      {error ? (
        <p className="error-message mt-1 text-sm text-aered-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs muted">{hint}</p>
      ) : null}
    </div>
  );
};

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix"> & {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  fieldClassName?: string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, prefix, suffix, fieldClassName, required, ...rest },
  ref
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={fieldClassName}>
      {(id) => (
        <div className="form-control-input">
          {prefix && <span className="control-prefix">{prefix}</span>}
          <input ref={ref} id={rest.id ?? id} required={required} aria-invalid={!!error} {...rest} />
          {suffix && <span className="control-suffix">{suffix}</span>}
        </div>
      )}
    </Field>
  );
});

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  fieldClassName?: string;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, fieldClassName, required, rows = 4, ...rest },
  ref
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={fieldClassName}>
      {(id) => (
        <div className="form-control-input">
          <textarea ref={ref} id={rest.id ?? id} rows={rows} required={required} aria-invalid={!!error} {...rest} />
        </div>
      )}
    </Field>
  );
});

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  options: { value: string; label: string }[];
  placeholder?: string;
  fieldClassName?: string;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, options, placeholder, fieldClassName, required, ...rest },
  ref
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={fieldClassName}>
      {(id) => (
        <div className="form-control-input">
          <select ref={ref} id={rest.id ?? id} required={required} aria-invalid={!!error} {...rest}>
            {placeholder !== undefined && <option value="">{placeholder}</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </Field>
  );
});

export const Checkbox: React.FC<
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label: React.ReactNode; description?: React.ReactNode }
> = ({ label, description, className, ...rest }) => {
  const id = useId();
  return (
    <div className={cn("aegov-check-item items-start", className)}>
      <input type="checkbox" id={rest.id ?? id} className="mt-1" {...rest} />
      <label htmlFor={rest.id ?? id} className="cursor-pointer">
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs muted">{description}</span>}
      </label>
    </div>
  );
};

export const Toggle: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
}> = ({ checked, onChange, label, disabled }) => (
  <label className="aegov-toggle">
    <input
      type="checkbox"
      className="peer sr-only"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span className="toggle-item" />
    {label && <span className="toggle-text text-sm">{label}</span>}
  </label>
);

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export type Tone = "success" | "info" | "warning" | "error" | "neutral" | "gold";

export const Badge: React.FC<{ tone?: Tone; solid?: boolean; className?: string; children: React.ReactNode; icon?: React.ReactNode }> = ({
  tone = "neutral",
  solid,
  className,
  children,
  icon,
}) => (
  <span
    className={cn(
      "aegov-badge whitespace-nowrap",
      tone === "success" && "badge-success",
      tone === "info" && "badge-info",
      tone === "warning" && "badge-warning",
      tone === "error" && "badge-error",
      tone === "neutral" && "!bg-aeblack-50 !text-aeblack-700",
      solid && "badge-solid",
      className
    )}
  >
    {icon}
    {children}
  </span>
);

export const Alert: React.FC<{
  tone?: "success" | "info" | "warning" | "error";
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  size?: "sm" | "base";
}> = ({ tone = "info", title, children, action, className, size = "base" }) => {
  const Icon = { success: CheckCircle2, info: Info, warning: AlertTriangle, error: XCircle }[tone];
  return (
    <div className={cn("aegov-alert", `alert-${tone}`, size === "sm" && "alert-sm", className)} role={tone === "error" ? "alert" : "status"}>
      <div className="alert-icon">
        <Icon aria-hidden />
      </div>
      <div className="alert-content">
        {title && <div className="alert-title">{title}</div>}
        {children && <div className="text-sm">{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
};

export const Spinner: React.FC<{ className?: string; label?: string }> = ({ className, label }) => (
  <span className={cn("inline-flex items-center gap-2 muted text-sm", className)} role="status">
    <Loader2 className="size-4 animate-spin text-primary-600" aria-hidden />
    {label}
  </span>
);

export const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn("animate-pulse rounded-lg bg-aeblack-100", className)} />
);

export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}> = ({ icon, title, description, action, className }) => (
  <div className={cn("flex flex-col items-center justify-center text-center py-12 px-6", className)}>
    <div className="mb-4 grid size-14 place-items-center rounded-full bg-primary-50 text-primary-600">
      {icon ?? <Inbox className="size-7" aria-hidden />}
    </div>
    <h3 className="text-lg font-semibold">{title}</h3>
    {description && <p className="mt-1 max-w-md text-sm muted">{description}</p>}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

export const ErrorState: React.FC<{ error: unknown; onRetry?: () => void; className?: string }> = ({ error, onRetry, className }) => {
  const { t } = usePrefs();
  const message = error instanceof Error ? error.message : t("Something went wrong.", "حدث خطأ ما.");
  return (
    <Alert
      tone="error"
      title={t("Couldn't load this", "تعذّر تحميل المحتوى")}
      className={className}
      action={
        onRetry && (
          <Button variant="outline" size="xs" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>
            {t("Try again", "إعادة المحاولة")}
          </Button>
        )
      }
    >
      {message}
    </Alert>
  );
};

export const ProgressBar: React.FC<{ value: number; className?: string; tone?: "primary" | "success" | "error" }> = ({
  value,
  className,
  tone = "primary",
}) => (
  <div className={cn("h-2 w-full overflow-hidden rounded-full bg-aeblack-100", className)}>
    <div
      className={cn(
        "h-full rounded-full transition-[width] duration-300",
        tone === "primary" && "bg-primary-600",
        tone === "success" && "bg-aegreen-600",
        tone === "error" && "bg-aered-600"
      )}
      style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
    />
  </div>
);

// ---------------------------------------------------------------------------
// Layout blocks
// ---------------------------------------------------------------------------

export const Card: React.FC<{
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  padded?: boolean;
}> = ({ title, subtitle, actions, children, className, bodyClassName, padded = true }) => (
  <section className={cn("surface shadow-xs", className)}>
    {(title || actions) && (
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-aeblack-100 px-5 py-4">
        <div className="min-w-0">
          {title && <h2 className="text-base font-semibold leading-6">{title}</h2>}
          {subtitle && <p className="mt-0.5 text-sm muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
    )}
    <div className={cn(padded && "p-5", bodyClassName)}>{children}</div>
  </section>
);

export const StatTile: React.FC<{
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "gold" | "red" | "green" | "blue" | "neutral";
  onClick?: () => void;
}> = ({ label, value, hint, icon, tone = "gold", onClick }) => {
  const toneClass = {
    gold: "bg-primary-50 text-primary-700",
    red: "bg-aered-50 text-aered-700",
    green: "bg-aegreen-50 text-aegreen-700",
    blue: "bg-techblue-50 text-techblue-700",
    neutral: "bg-aeblack-50 text-aeblack-700",
  }[tone];
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cn(
        "surface flex w-full items-start gap-4 p-5 text-start",
        onClick && "transition hover:border-primary-300 hover:shadow-md focus-visible:outline-2"
      )}
    >
      {icon && <div className={cn("grid size-11 shrink-0 place-items-center rounded-xl", toneClass)}>{icon}</div>}
      <div className="min-w-0">
        <div className="text-sm muted">{label}</div>
        <div className="mt-1 font-heading text-2xl font-bold tabular-nums">{value}</div>
        {hint && <div className="mt-1 text-xs muted">{hint}</div>}
      </div>
    </Comp>
  );
};

export const KeyValue: React.FC<{ items: { label: React.ReactNode; value: React.ReactNode }[]; columns?: 1 | 2 | 3 }> = ({
  items,
  columns = 2,
}) => (
  <dl className={cn("grid gap-x-6 gap-y-4", columns === 2 && "sm:grid-cols-2", columns === 3 && "sm:grid-cols-3")}>
    {items.map((it, i) => (
      <div key={i} className="min-w-0">
        <dt className="text-xs font-medium uppercase tracking-wide muted">{it.label}</dt>
        <dd className="mt-1 break-words text-sm">{it.value ?? "—"}</dd>
      </div>
    ))}
  </dl>
);

export const Avatar: React.FC<{ name: string; size?: "xs" | "sm" | "base" | "lg"; className?: string }> = ({
  name,
  size = "sm",
  className,
}) => {
  const initials = name
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  return (
    <span className={cn("aegov-avatar", `avatar-${size}`, className)} aria-hidden>
      <span className="grid size-full place-items-center rounded-full bg-primary-100 font-semibold text-primary-800">
        {initials || "?"}
      </span>
    </span>
  );
};

export const Divider: React.FC<{ className?: string }> = ({ className }) => (
  <hr className={cn("border-aeblack-100", className)} />
);
