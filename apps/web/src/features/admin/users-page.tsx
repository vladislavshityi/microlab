import { useState, type SyntheticEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AccountApiError, createUser, listUsers, resetPassword, updateUser } from "@/api/accounts";
import type { AdminUserInfo, UserRole } from "@/api/schemas";
import { Button } from "@/components/ui/button";
import { Field, FormError, inputClass } from "@/features/auth/auth-pages";
import { authErrorMessage, ROLE_LABEL } from "@/features/auth/auth-query";
import { PageShell } from "@/features/groups/groups-pages";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { locale, t } from "@/i18n/t";

const PAGE_SIZE = 25;
const ROLES: readonly UserRole[] = ["student", "teacher", "admin"];

function formatDate(value: string | null): string {
  if (value === null) return t("admin.users.never");
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function actionError(error: unknown): string {
  if (error instanceof AccountApiError && error.status === 422 && error.code === "VALIDATION_ERROR") {
    return t("admin.users.selfError");
  }
  return error instanceof AccountApiError && error.code === "EMAIL_TAKEN" ? authErrorMessage(error) : t("admin.users.error");
}

export function UsersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const query = useDebouncedValue(search.trim(), 300);
  const users = useQuery({
    queryKey: ["admin", "users", query, offset],
    queryFn: () => listUsers({ q: query, offset, limit: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  // Временный пароль показывается один раз и не сохраняется.
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (action: () => Promise<string | null>) => action(),
    onMutate: () => {
      setError(null);
      setNotice(null);
    },
    onSuccess: (message) => {
      setNotice(message);
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (caught) => {
      setError(actionError(caught));
    },
  });

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("teacher");
  const onCreate = (event: SyntheticEvent) => {
    event.preventDefault();
    run.mutate(async () => {
      const created = await createUser({ email, displayName: name, role });
      setEmail("");
      setName("");
      return t("admin.users.tempPassword", { email: created.user.email, password: created.temporaryPassword ?? "" });
    });
  };

  const reset = (user: AdminUserInfo) => {
    run.mutate(async () => {
      const result = await resetPassword(user.id);
      return t("admin.users.tempPassword", { email: user.email, password: result.temporaryPassword });
    });
  };

  const total = users.data?.total ?? 0;
  return (
    <PageShell title={t("admin.users.title")}>
      <form className="flex flex-wrap items-end gap-3 rounded-lg border p-4" onSubmit={onCreate}>
        <div className="w-64">
          <Field label={t("auth.email")}>
            {(props) => (
              <input {...props} className={inputClass} type="email" required value={email}
                onChange={(event) => { setEmail(event.target.value); }} />
            )}
          </Field>
        </div>
        <div className="w-64">
          <Field label={t("auth.displayName")}>
            {(props) => (
              <input {...props} className={inputClass} required maxLength={100} value={name}
                onChange={(event) => { setName(event.target.value); }} />
            )}
          </Field>
        </div>
        <div className="w-44">
          <Field label={t("admin.users.role")}>
            {(props) => (
              <select {...props} className={inputClass} value={role}
                onChange={(event) => { setRole(event.target.value as UserRole); }}>
                {ROLES.map((item) => (
                  <option key={item} value={item}>{t(ROLE_LABEL[item])}</option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <Button type="submit" disabled={run.isPending}>
          {t("admin.users.create")}
        </Button>
      </form>

      {notice === null ? null : (
        <p role="status" className="rounded-md border border-success/40 bg-success-muted px-3 py-2 text-sm font-medium select-all">
          {notice}
        </p>
      )}
      <FormError message={error} />

      <div className="w-80">
        <Field label={t("admin.users.search")}>
          {(props) => (
            <input {...props} className={inputClass} type="search" value={search}
              onChange={(event) => { setSearch(event.target.value); setOffset(0); }} />
          )}
        </Field>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="py-2">{t("auth.displayName")}</th>
            <th>{t("auth.email")}</th>
            <th>{t("admin.users.role")}</th>
            <th>{t("admin.users.status")}</th>
            <th>{t("admin.users.lastLogin")}</th>
            <th>{t("admin.users.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {users.data?.items.map((user) => (
            <tr key={user.id} className="border-t">
              <td className="py-2">{user.displayName}</td>
              <td>{user.email}</td>
              <td>
                <select aria-label={`${t("admin.users.role")}: ${user.email}`} className={`${inputClass} h-8 w-40`} value={user.role}
                  onChange={(event) => {
                    const next = event.target.value as UserRole;
                    run.mutate(async () => { await updateUser(user.id, { role: next }); return null; });
                  }}>
                  {ROLES.map((item) => (
                    <option key={item} value={item}>{t(ROLE_LABEL[item])}</option>
                  ))}
                </select>
              </td>
              <td>{user.isActive ? t("admin.users.active") : t("admin.users.inactive")}</td>
              <td>{formatDate(user.lastLoginAt)}</td>
              <td className="flex gap-1 py-1">
                <Button type="button" size="xs" variant="outline" onClick={() => { reset(user); }}>
                  {t("admin.users.resetPassword")}
                </Button>
                <Button type="button" size="xs" variant="ghost"
                  onClick={() => { run.mutate(async () => { await updateUser(user.id, { isActive: !user.isActive }); return null; }); }}>
                  {user.isActive ? t("admin.users.deactivate") : t("admin.users.activate")}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-3 text-sm">
        <span>{t("admin.users.total", { count: String(total) })}</span>
        <Button type="button" size="sm" variant="outline" disabled={offset === 0}
          onClick={() => { setOffset(Math.max(0, offset - PAGE_SIZE)); }}>
          {t("admin.users.prev")}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={offset + PAGE_SIZE >= total}
          onClick={() => { setOffset(offset + PAGE_SIZE); }}>
          {t("admin.users.next")}
        </Button>
      </div>
    </PageShell>
  );
}
