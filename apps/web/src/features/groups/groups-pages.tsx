import { useState, type SyntheticEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, Trash2 } from "lucide-react";

import {
  createGroup,
  createInvite,
  deleteGroup,
  getGroup,
  listGroupProjects,
  listGroups,
  listInvites,
  listMembers,
  removeMember,
  revokeInvite,
} from "@/api/accounts";
import type { InviteInfo } from "@/api/schemas";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/features/auth/auth-pages";
import { UserMenu } from "@/features/auth/user-menu";
import { locale, t } from "@/i18n/t";
import { navigate } from "@/lib/router";

const GROUPS_KEY = ["groups"] as const;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

/** Каркас страниц вне рабочего пространства: заголовок с меню пользователя. */
export function PageShell({ title, children, back }: { title: string; children: ReactNode; back?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center justify-between gap-4 border-b px-3 text-sm">
        <a href="/" className="font-semibold">
          {t("app.name")}
        </a>
        <UserMenu />
      </header>
      <main className="mx-auto grid w-full max-w-5xl gap-6 p-6">
        {back}
        <h1 className="text-xl font-semibold">{title}</h1>
        {children}
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-3 rounded-lg border p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function ErrorText({ show }: { show: boolean }) {
  return show ? (
    <p role="alert" className="text-sm text-error">
      {t("groups.loadError")}
    </p>
  ) : null;
}

export function GroupsPage() {
  const queryClient = useQueryClient();
  const groups = useQuery({ queryKey: GROUPS_KEY, queryFn: listGroups });
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: createGroup,
    onSuccess: () => {
      setName("");
      void queryClient.invalidateQueries({ queryKey: GROUPS_KEY });
    },
  });
  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (name.trim() !== "") create.mutate(name.trim());
  };
  return (
    <PageShell title={t("groups.title")}>
      <form className="flex items-end gap-2" onSubmit={onSubmit}>
        <div className="w-72">
          <Field label={t("groups.create.label")}>
            {(props) => (
              <input {...props} className={inputClass} required maxLength={100} value={name}
                onChange={(event) => { setName(event.target.value); }} />
            )}
          </Field>
        </div>
        <Button type="submit" disabled={create.isPending}>
          {t("groups.create.submit")}
        </Button>
      </form>
      <ErrorText show={groups.isError || create.isError} />
      {groups.data?.length === 0 ? <p className="text-sm text-muted-foreground">{t("groups.empty")}</p> : null}
      <ul className="grid gap-2">
        {groups.data?.map((group) => (
          <li key={group.id} className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div className="grid">
              <span className="font-medium">{group.name}</span>
              <span className="text-xs text-muted-foreground">
                {t("groups.members", { count: String(group.memberCount) })} ·{" "}
                {t("groups.teacher", { name: group.teacher.displayName })}
              </span>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => { navigate(`/groups/${group.id}`); }}>
              {t("groups.open")}
            </Button>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}

function joinLink(code: string): string {
  return `${window.location.origin}/join/${encodeURIComponent(code)}`;
}

function InviteRow({ invite, onRevoke }: { invite: InviteInfo; onRevoke: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = joinLink(invite.code);
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm">
      <code className="font-mono text-base tracking-wider">{invite.code}</code>
      <span className="text-xs text-muted-foreground">
        {t("groups.invites.uses", {
          uses: String(invite.uses),
          max: invite.maxUses === null ? t("groups.invites.unlimited") : String(invite.maxUses),
        })}{" "}
        ·{" "}
        {invite.expiresAt === null
          ? t("groups.invites.forever")
          : t("groups.invites.until", { date: formatDate(invite.expiresAt) })}
        {invite.active ? null : ` · ${t("groups.invites.inactive")}`}
      </span>
      {invite.active ? (
        <span className="ml-auto flex gap-2">
          <input readOnly aria-label={t("groups.invites.link")} value={link} className={`${inputClass} h-8 w-72 text-xs`} />
          <Button type="button" variant="outline" size="sm" onClick={() => {
            void navigator.clipboard.writeText(link).then(() => { setCopied(true); });
          }}>
            <Copy aria-hidden="true" />
            {copied ? t("groups.invites.copied") : t("groups.invites.copyLink")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onRevoke}>
            {t("groups.invites.revoke")}
          </Button>
        </span>
      ) : null}
    </li>
  );
}

export function GroupPage({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const key = ["groups", id] as const;
  const group = useQuery({ queryKey: key, queryFn: () => getGroup(id) });
  const members = useQuery({ queryKey: [...key, "members"], queryFn: () => listMembers(id) });
  const invites = useQuery({ queryKey: [...key, "invites"], queryFn: () => listInvites(id) });
  const projects = useQuery({ queryKey: [...key, "projects"], queryFn: () => listGroupProjects(id) });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
  };
  const [days, setDays] = useState("7");
  const [maxUses, setMaxUses] = useState("");
  const mutation = useMutation({ mutationFn: (action: () => Promise<unknown>) => action(), onSuccess: refresh });

  const onCreateInvite = (event: SyntheticEvent) => {
    event.preventDefault();
    const expires = days.trim() === "" ? null : Number(days) * 24;
    const uses = maxUses.trim() === "" ? null : Number(maxUses);
    mutation.mutate(() => createInvite(id, { expiresInHours: expires, maxUses: uses }));
  };

  const back = (
    <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => { navigate("/groups"); }}>
      <ArrowLeft aria-hidden="true" />
      {t("groups.back")}
    </Button>
  );
  const name = group.data?.name ?? "";
  return (
    <PageShell title={name} back={back}>
      <ErrorText show={group.isError || mutation.isError} />
      <Section title={t("groups.invites.title")}>
        <form className="flex flex-wrap items-end gap-3" onSubmit={onCreateInvite}>
          <div className="w-64">
            <Field label={t("groups.invites.expires")}>
              {(props) => (
                <input {...props} className={inputClass} type="number" min={1} max={365} value={days}
                  onChange={(event) => { setDays(event.target.value); }} />
              )}
            </Field>
          </div>
          <div className="w-64">
            <Field label={t("groups.invites.maxUses")}>
              {(props) => (
                <input {...props} className={inputClass} type="number" min={1} value={maxUses}
                  onChange={(event) => { setMaxUses(event.target.value); }} />
              )}
            </Field>
          </div>
          <Button type="submit" disabled={mutation.isPending}>
            {t("groups.invites.create")}
          </Button>
        </form>
        {invites.data?.length === 0 ? <p className="text-sm text-muted-foreground">{t("groups.invites.empty")}</p> : null}
        <ul className="grid gap-2">
          {invites.data?.map((invite) => (
            <InviteRow key={invite.id} invite={invite} onRevoke={() => { mutation.mutate(() => revokeInvite(id, invite.id)); }} />
          ))}
        </ul>
      </Section>
      <Section title={t("groups.membersTitle")}>
        {members.data?.length === 0 ? <p className="text-sm text-muted-foreground">{t("groups.membersEmpty")}</p> : null}
        <ul className="grid gap-1">
          {members.data?.map((member) => (
            <li key={member.id} className="flex items-center justify-between text-sm">
              <span>
                {member.displayName} <span className="text-muted-foreground">{member.email}</span>
              </span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t("groups.removeMember", { name: member.displayName })}
                onClick={() => {
                  if (window.confirm(t("groups.removeConfirm", { name: member.displayName }))) {
                    mutation.mutate(() => removeMember(id, member.id));
                  }
                }}>
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t("groups.projects.title")}>
        {projects.data?.length === 0 ? <p className="text-sm text-muted-foreground">{t("groups.projects.empty")}</p> : null}
        <ul className="grid gap-1">
          {projects.data?.map((project) => (
            <li key={project.id} className="flex items-center justify-between text-sm">
              <span>
                <span className="font-medium">{project.name}</span> — {project.owner.displayName}{" "}
                <span className="text-xs text-muted-foreground">
                  {t("groups.projects.updated", { date: formatDate(project.updatedAt) })}
                </span>
              </span>
              {/* Полная загрузка страницы: рабочее пространство открывает проект заново. */}
              <a href={`/view/${project.id}`} className="text-primary underline-offset-4 hover:underline">
                {t("groups.projects.open")}
              </a>
            </li>
          ))}
        </ul>
      </Section>
      <Button type="button" variant="destructive" className="w-fit" disabled={group.data === undefined}
        onClick={() => {
          if (window.confirm(t("groups.deleteConfirm", { name }))) {
            void deleteGroup(id).then(() => {
              void queryClient.invalidateQueries({ queryKey: GROUPS_KEY });
              navigate("/groups");
            });
          }
        }}>
        {t("groups.delete")}
      </Button>
    </PageShell>
  );
}
