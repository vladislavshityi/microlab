import { useQuery, type QueryClient } from "@tanstack/react-query";

import { AccountApiError, fetchCurrentUser } from "@/api/accounts";
import type { UserInfo } from "@/api/schemas";
import { t, type PlainTranslationKey } from "@/i18n/t";

export const CURRENT_USER_KEY = ["auth", "me"] as const;

/** Текущий пользователь (null — вход не выполнен); серверное состояние в кэше TanStack Query. */
export function useCurrentUser() {
  return useQuery({
    queryKey: CURRENT_USER_KEY,
    queryFn: fetchCurrentUser,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function setCurrentUser(queryClient: QueryClient, user: UserInfo | null): void {
  queryClient.setQueryData(CURRENT_USER_KEY, user);
}

const KNOWN_ERRORS = new Set([
  "INVALID_CREDENTIALS",
  "RATE_LIMITED",
  "INVALID_INVITE_CODE",
  "EMAIL_TAKEN",
  "WEAK_PASSWORD",
  "VALIDATION_ERROR",
]);

/** Текст ошибки формы по коду ошибки API. */
export function authErrorMessage(error: unknown): string {
  if (error instanceof AccountApiError && error.code !== null && KNOWN_ERRORS.has(error.code)) {
    return t(`auth.error.${error.code}` as PlainTranslationKey);
  }
  return t("auth.error.generic");
}

export const ROLE_LABEL: Record<UserInfo["role"], PlainTranslationKey> = {
  student: "auth.role.student",
  teacher: "auth.role.teacher",
  admin: "auth.role.admin",
};
