import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { setUnauthorizedHandler } from "@/api/http";
import type { UserInfo } from "@/api/schemas";
import { Button } from "@/components/ui/button";
import { UsersPage } from "@/features/admin/users-page";
import { GroupPage, GroupsPage } from "@/features/groups/groups-pages";
import { Workspace } from "@/features/workspace/workspace";
import { t } from "@/i18n/t";
import { loginPath, matchRoute, navigate, useLocation, type Route } from "@/lib/router";

import { AuthCard, ChangePasswordPage, LoginPage, RegisterPage } from "./auth-pages";
import { setCurrentUser, useCurrentUser } from "./auth-query";

function Redirect({ to }: { to: string }) {
  useEffect(() => {
    navigate(to, { replace: true });
  }, [to]);
  return null;
}

function Message({ text }: { text: string }) {
  return (
    <AuthCard title={text}>
      <Button type="button" variant="outline" onClick={() => { window.location.assign("/"); }}>
        {t("auth.backHome")}
      </Button>
    </AuthCard>
  );
}

const STAFF: readonly UserInfo["role"][] = ["teacher", "admin"];

/** Роли, которым доступен маршрут (undefined — любому вошедшему пользователю). */
function allowedRoles(route: Route): readonly UserInfo["role"][] | undefined {
  switch (route.name) {
    case "groups":
    case "group":
    case "viewProject":
      return STAFF;
    case "adminUsers":
      return ["admin"];
    default:
      return undefined;
  }
}

/**
 * Маршруты приложения и защита: без входа — страница входа (с возвратом на исходный адрес),
 * с временным паролем — обязательная смена пароля, недоступные роли — сообщение.
 */
export function AppRoutes() {
  const location = useLocation();
  const route = matchRoute(location);
  const queryClient = useQueryClient();
  const { data: user, isPending, isError } = useCurrentUser();

  // Сессия закончилась во время работы: на страницу входа с возвратом.
  useEffect(
    () =>
      setUnauthorizedHandler(() => {
        setCurrentUser(queryClient, null);
        const current = window.location.pathname + window.location.search;
        if (!current.startsWith("/login")) navigate(loginPath(current), { replace: true });
      }),
    [queryClient],
  );

  if (isPending) {
    return <p className="p-6 text-sm text-muted-foreground" role="status">{t("auth.loading")}</p>;
  }
  if (isError) return <Message text={t("auth.error.generic")} />;

  if (route.name === "login" || route.name === "register") {
    if (user !== null) return <Redirect to={route.name === "login" ? route.next : "/"} />;
    return route.name === "login" ? <LoginPage next={route.next} /> : <RegisterPage code={route.code} />;
  }
  if (user === null) return <Redirect to={loginPath(location)} />;
  if (user.mustChangePassword && route.name !== "changePassword") {
    return <Redirect to={`/change-password?next=${encodeURIComponent(location)}`} />;
  }
  const roles = allowedRoles(route);
  if (roles !== undefined && !roles.includes(user.role)) return <Message text={t("auth.forbidden")} />;

  switch (route.name) {
    case "workspace":
      return <Workspace />;
    case "viewProject":
      return <Workspace viewProjectId={route.id} />;
    case "changePassword":
      return <ChangePasswordPage next={route.next} forced={user.mustChangePassword} />;
    case "groups":
      return <GroupsPage />;
    case "group":
      return <GroupPage id={route.id} />;
    case "adminUsers":
      return <UsersPage />;
    default:
      return <Message text={t("auth.notFound")} />;
  }
}
