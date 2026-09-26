import { useId, useState, type SyntheticEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { changePassword, login, register } from "@/api/accounts";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n/t";
import { navigate } from "@/lib/router";

import { authErrorMessage, setCurrentUser } from "./auth-query";

export const inputClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive";

/** Поле формы с подписью и связанной подсказкой. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (props: { id: string; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children(hint === undefined ? { id } : { id, "aria-describedby": hintId })}
      {hint === undefined ? null : (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  return (
    <p role="alert" aria-live="assertive" className="min-h-5 text-sm text-error">
      {message}
    </p>
  );
}

/** Центрированная карточка для страниц входа. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
        <p className="mb-1 text-xs font-semibold text-muted-foreground">{t("app.name")}</p>
        <h1 className="mb-4 text-lg font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}

function useSubmit(action: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    action()
      .catch((caught: unknown) => {
        setError(caught instanceof Error && caught.name === "FormError" ? caught.message : authErrorMessage(caught));
      })
      .finally(() => {
        setPending(false);
      });
  };
  return { error, pending, onSubmit };
}

function formError(message: string): Error {
  const error = new Error(message);
  error.name = "FormError";
  return error;
}

export function LoginPage({ next }: { next: string }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { error, pending, onSubmit } = useSubmit(async () => {
    const user = await login(email, password);
    setCurrentUser(queryClient, user);
    navigate(user.mustChangePassword ? `/change-password?next=${encodeURIComponent(next)}` : next, {
      replace: true,
    });
  });
  return (
    <AuthCard title={t("auth.login.title")}>
      <form className="grid gap-3" onSubmit={onSubmit} noValidate>
        <Field label={t("auth.email")}>
          {(props) => (
            <input {...props} className={inputClass} type="email" autoComplete="username" required
              value={email} onChange={(event) => { setEmail(event.target.value); }} aria-invalid={error !== null} />
          )}
        </Field>
        <Field label={t("auth.password")}>
          {(props) => (
            <input {...props} className={inputClass} type="password" autoComplete="current-password" required
              value={password} onChange={(event) => { setPassword(event.target.value); }} aria-invalid={error !== null} />
          )}
        </Field>
        <FormError message={error} />
        <Button type="submit" disabled={pending}>
          {t("auth.login.submit")}
        </Button>
        <a href="/register" className="text-center text-sm text-primary underline-offset-4 hover:underline"
          onClick={(event) => { event.preventDefault(); navigate("/register"); }}>
          {t("auth.login.toRegister")}
        </a>
      </form>
    </AuthCard>
  );
}

export function RegisterPage({ code }: { code: string }) {
  const queryClient = useQueryClient();
  const [inviteCode, setInviteCode] = useState(code);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const { error, pending, onSubmit } = useSubmit(async () => {
    const user = await register({ inviteCode, email, displayName, password });
    setCurrentUser(queryClient, user);
    navigate("/", { replace: true });
  });
  return (
    <AuthCard title={t("auth.register.title")}>
      <form className="grid gap-3" onSubmit={onSubmit} noValidate>
        <Field label={t("auth.inviteCode")} hint={t("auth.register.hint")}>
          {(props) => (
            <input {...props} className={`${inputClass} font-mono uppercase`} autoComplete="off" required
              value={inviteCode} onChange={(event) => { setInviteCode(event.target.value); }} />
          )}
        </Field>
        <Field label={t("auth.displayName")}>
          {(props) => (
            <input {...props} className={inputClass} autoComplete="name" required maxLength={100}
              value={displayName} onChange={(event) => { setDisplayName(event.target.value); }} />
          )}
        </Field>
        <Field label={t("auth.email")}>
          {(props) => (
            <input {...props} className={inputClass} type="email" autoComplete="email" required
              value={email} onChange={(event) => { setEmail(event.target.value); }} />
          )}
        </Field>
        <Field label={t("auth.password")} hint={t("auth.passwordHint")}>
          {(props) => (
            <input {...props} className={inputClass} type="password" autoComplete="new-password" required minLength={8}
              value={password} onChange={(event) => { setPassword(event.target.value); }} />
          )}
        </Field>
        <FormError message={error} />
        <Button type="submit" disabled={pending}>
          {t("auth.register.submit")}
        </Button>
        <a href="/login" className="text-center text-sm text-primary underline-offset-4 hover:underline"
          onClick={(event) => { event.preventDefault(); navigate("/login"); }}>
          {t("auth.register.toLogin")}
        </a>
      </form>
    </AuthCard>
  );
}

export function ChangePasswordPage({ next, forced }: { next: string; forced: boolean }) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const { error, pending, onSubmit } = useSubmit(async () => {
    if (password !== repeat) throw formError(t("auth.changePassword.mismatch"));
    const user = await changePassword(current, password);
    setCurrentUser(queryClient, user);
    navigate(next, { replace: true });
  });
  return (
    <AuthCard title={t("auth.changePassword.title")}>
      {forced ? <p className="mb-3 text-sm text-muted-foreground">{t("auth.changePassword.forced")}</p> : null}
      <form className="grid gap-3" onSubmit={onSubmit} noValidate>
        <Field label={t("auth.changePassword.current")}>
          {(props) => (
            <input {...props} className={inputClass} type="password" autoComplete="current-password" required
              value={current} onChange={(event) => { setCurrent(event.target.value); }} />
          )}
        </Field>
        <Field label={t("auth.changePassword.new")} hint={t("auth.passwordHint")}>
          {(props) => (
            <input {...props} className={inputClass} type="password" autoComplete="new-password" required
              value={password} onChange={(event) => { setPassword(event.target.value); }} />
          )}
        </Field>
        <Field label={t("auth.changePassword.repeat")}>
          {(props) => (
            <input {...props} className={inputClass} type="password" autoComplete="new-password" required
              value={repeat} onChange={(event) => { setRepeat(event.target.value); }} />
          )}
        </Field>
        <FormError message={error} />
        <Button type="submit" disabled={pending}>
          {t("auth.changePassword.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
