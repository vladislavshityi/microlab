import type { z } from "zod";

import { apiFetch } from "./http";
import {
  AdminUserCreatedSchema,
  AdminUserInfoSchema,
  AdminUserListSchema,
  GroupListSchema,
  GroupMemberListSchema,
  GroupProjectListSchema,
  GroupSummarySchema,
  InviteInfoSchema,
  InviteListSchema,
  readDisplayErrorCode,
  TemporaryPasswordSchema,
  UserInfoSchema,
  type DisplayErrorCode,
  type UserRole,
} from "./schemas";

const TIMEOUT_MS = 15_000;

/** Ошибка запроса к API учётных записей и групп; `code` — стабильный код ошибки API. */
export class AccountApiError extends Error {
  readonly status: number | null;
  readonly code: DisplayErrorCode | null;
  /** Поля с ошибками (`details[].field`), например `password`. */
  readonly fields: readonly string[];

  constructor(status: number | null, code: DisplayErrorCode | null, fields: readonly string[] = []) {
    super(`Account API request failed (HTTP ${status ?? "-"}, ${code ?? "no code"}).`);
    this.name = "AccountApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

function readFields(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [];
  const error = (body as { error?: { details?: unknown } }).error;
  if (!Array.isArray(error?.details)) return [];
  return error.details
    .map((detail: unknown) => (typeof detail === "object" && detail !== null ? (detail as { field?: unknown }).field : null))
    .filter((field): field is string => typeof field === "string");
}

async function call(url: string, method: string, body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await apiFetch(url, {
      method,
      headers:
        body === undefined
          ? { Accept: "application/json" }
          : { Accept: "application/json", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AccountApiError(null, null);
  }
  const data: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new AccountApiError(response.status, readDisplayErrorCode(data), readFields(data));
  }
  return data;
}

async function json<S extends z.ZodType>(schema: S, url: string, method = "GET", body?: unknown): Promise<z.infer<S>> {
  const data = await call(url, method, body);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new AccountApiError(200, null);
  return parsed.data;
}

const AUTH = "/api/v1/auth";
const GROUPS = "/api/v1/groups";
const USERS = "/api/v1/admin/users";

// --- аутентификация ---

/** Текущий пользователь или null, если вход не выполнен. */
export async function fetchCurrentUser() {
  try {
    return await json(UserInfoSchema, `${AUTH}/me`);
  } catch (error) {
    if (error instanceof AccountApiError && error.status === 401) return null;
    throw error;
  }
}

export const login = (email: string, password: string) =>
  json(UserInfoSchema, `${AUTH}/login`, "POST", { email, password });

export const register = (data: { inviteCode: string; email: string; displayName: string; password: string }) =>
  json(UserInfoSchema, `${AUTH}/register`, "POST", data);

export const logout = () => call(`${AUTH}/logout`, "POST");

export const changePassword = (currentPassword: string, newPassword: string) =>
  json(UserInfoSchema, `${AUTH}/change-password`, "POST", { currentPassword, newPassword });

// --- группы ---

const group = (id: string) => `${GROUPS}/${encodeURIComponent(id)}`;

export const listGroups = () => json(GroupListSchema, GROUPS).then((data) => data.items);
export const getGroup = (id: string) => json(GroupSummarySchema, group(id));
export const createGroup = (name: string) => json(GroupSummarySchema, GROUPS, "POST", { name });
export const deleteGroup = (id: string) => call(group(id), "DELETE");
export const listMembers = (id: string) => json(GroupMemberListSchema, `${group(id)}/members`).then((d) => d.items);
export const removeMember = (id: string, userId: string) =>
  call(`${group(id)}/members/${encodeURIComponent(userId)}`, "DELETE");
export const listInvites = (id: string) => json(InviteListSchema, `${group(id)}/invites`).then((d) => d.items);
export const createInvite = (id: string, options: { expiresInHours: number | null; maxUses: number | null }) =>
  json(InviteInfoSchema, `${group(id)}/invites`, "POST", options);
export const revokeInvite = (id: string, inviteId: string) =>
  json(InviteInfoSchema, `${group(id)}/invites/${encodeURIComponent(inviteId)}/revoke`, "POST");
export const listGroupProjects = (id: string) =>
  json(GroupProjectListSchema, `${group(id)}/projects`).then((d) => d.items);

// --- администрирование ---

export function listUsers(params: { q?: string; offset?: number; limit?: number }) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return json(AdminUserListSchema, `${USERS}${suffix}`);
}

export const createUser = (data: { email: string; displayName: string; role: UserRole }) =>
  json(AdminUserCreatedSchema, USERS, "POST", data);

export const updateUser = (id: string, patch: { role?: UserRole; isActive?: boolean }) =>
  json(AdminUserInfoSchema, `${USERS}/${encodeURIComponent(id)}`, "PATCH", patch);

export const resetPassword = (id: string) =>
  json(TemporaryPasswordSchema, `${USERS}/${encodeURIComponent(id)}/reset-password`, "POST");
