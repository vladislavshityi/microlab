import { useQueryClient } from "@tanstack/react-query";
import { UserRound } from "lucide-react";

import { logout } from "@/api/accounts";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { flushBeforeLeave } from "@/features/projects/project-session";
import { t } from "@/i18n/t";
import { navigate } from "@/lib/router";

import { ROLE_LABEL, setCurrentUser, useCurrentUser } from "./auth-query";

/** Меню учётной записи: имя и роль, разделы по роли, смена пароля и выход. */
export function UserMenu() {
  const { data: user } = useCurrentUser();
  const queryClient = useQueryClient();
  if (user === undefined || user === null) return null;

  const go = (path: string) => {
    // Переход в рабочее пространство и обратно — через перезагрузку: проект открывается заново.
    void flushBeforeLeave().then(() => {
      window.location.assign(path);
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={t("auth.menu.trigger", { name: user.displayName })}>
          <UserRound aria-hidden="true" />
          <span className="max-w-40 truncate">{user.displayName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="grid text-xs">
          <span className="font-medium">{user.displayName}</span>
          <span className="text-muted-foreground">
            {t(ROLE_LABEL[user.role])} · {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => { go("/"); }}>{t("auth.menu.workspace")}</DropdownMenuItem>
        {user.role === "student" ? null : (
          <DropdownMenuItem onSelect={() => { go("/groups"); }}>{t("auth.menu.groups")}</DropdownMenuItem>
        )}
        {user.role === "admin" ? (
          <DropdownMenuItem onSelect={() => { go("/admin/users"); }}>{t("auth.menu.users")}</DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => { go("/change-password"); }}>{t("auth.menu.changePassword")}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void flushBeforeLeave()
              .then(() => logout())
              .catch(() => undefined)
              .finally(() => {
                setCurrentUser(queryClient, null);
                navigate("/login", { replace: true });
                window.location.reload();
              });
          }}
        >
          {t("auth.menu.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
