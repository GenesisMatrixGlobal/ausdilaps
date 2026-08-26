"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import type { Department } from "@/lib/departments";
import {
  removeStaff,
  resendInvite,
  setStaffActive,
  updateStaff,
  type ActionResult,
  type StaffRow,
} from "./actions";

/** "3 days ago" — only used for invites, so days is the right resolution. */
function inviteAge(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Supabase invite links are short-lived, so an old unaccepted invite needs resending
 *  rather than chasing. Three days is comfortably past any sensible expiry. */
function isStale(iso: string | null): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() > 3 * 86_400_000;
}

export function StaffTable({
  rows,
  departments,
  currentUserId,
}: {
  rows: StaffRow[];
  departments: Department[];
  currentUserId: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  function run(action: (fd: FormData) => Promise<ActionResult>, formData: FormData) {
    start(async () => {
      const res = await action(formData);
      setResult(res);
      if (res.ok) setEditing(null);
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ad-border bg-ad-surface/40 px-6 py-10 text-center">
        <p className="font-semibold text-ad-ink">No staff accounts yet</p>
        <p className="mt-1.5 text-sm text-ad-muted">Invite your first staff member above.</p>
      </div>
    );
  }

  return (
    <div>
      {result && (
        <p
          className={cn(
            "mb-4 rounded-lg px-3 py-2 text-sm",
            result.ok
              ? "border border-ad-steel/30 bg-ad-steel/5 text-ad-ink"
              : "border border-ad-orange/30 bg-ad-orange/5 text-ad-ink"
          )}
        >
          {result.ok ? result.message : result.error}
        </p>
      )}

      <div className="divide-y divide-ad-border overflow-hidden rounded-xl border border-ad-border bg-white">
        {rows.map((row) => {
          const isSelf = row.id === currentUserId;
          const isAdminRole = row.role === "admin" || row.role === "superadmin";

          return (
            <div key={row.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ad-ink">
                      {row.full_name || row.email}
                    </span>
                    <span className="rounded bg-ad-surface px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-ad-muted">
                      {row.role}
                    </span>
                    {isSelf && (
                      <span className="rounded bg-ad-steel/10 px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-ad-steel">
                        You
                      </span>
                    )}
                    {!row.is_active && (
                      <span className="rounded bg-ad-orange/10 px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-ad-orange">
                        Deactivated
                      </span>
                    )}
                    {row.is_active && !row.last_sign_in_at && (
                      <span className="rounded bg-ad-orange/10 px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-ad-orange">
                        Pending invite
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-sm text-ad-muted">{row.email}</p>
                  <p className="mt-1.5 text-sm text-ad-muted">
                    {isAdminRole
                      ? "All departments"
                      : row.departments.length > 0
                        ? row.departments
                            .map((s) => departments.find((d) => d.slug === s)?.label ?? s)
                            .join(", ")
                        : "No departments assigned"}
                  </p>
                  {row.is_active && !row.last_sign_in_at && (
                    <p className="mt-1.5 text-sm text-ad-orange">
                      {inviteAge(row.invited_at) === null
                        ? "Hasn't signed in yet."
                        : `Invited ${inviteAge(row.invited_at)} — not accepted yet.`}
                      {isStale(row.invited_at) && " The link has almost certainly expired — send a new one."}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(editing === row.id ? null : row.id)}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    {editing === row.id ? "Close" : "Edit access"}
                  </button>

                  <form
                    action={(fd) => run(resendInvite, fd)}
                    className={pending ? "opacity-60" : undefined}
                  >
                    <input type="hidden" name="email" value={row.email} />
                    <button
                      type="submit"
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      Resend link
                    </button>
                  </form>

                  {!isSelf && (
                    <form
                      action={(fd) => run(setStaffActive, fd)}
                      className={pending ? "opacity-60" : undefined}
                    >
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="active" value={String(!row.is_active)} />
                      <button
                        type="submit"
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        {row.is_active ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  )}
                </div>
              </div>

              {editing === row.id && (
                <form
                  action={(fd) => run(updateStaff, fd)}
                  className="mt-4 rounded-lg border border-ad-border bg-ad-surface/40 p-4"
                >
                  <input type="hidden" name="id" value={row.id} />

                  <EditFields row={row} departments={departments} />

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={pending}
                      className={cn(
                        buttonVariants({ variant: "primary", size: "sm" }),
                        pending && "opacity-60"
                      )}
                    >
                      {pending ? "Saving…" : "Save access"}
                    </button>
                    {!isSelf && (
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            !confirm(
                              `Permanently remove ${row.email}? This deletes their account.`
                            )
                          )
                            return;
                          const fd = new FormData();
                          fd.set("id", row.id);
                          run(removeStaff, fd);
                        }}
                        className="text-sm font-medium text-ad-orange hover:underline"
                      >
                        Remove permanently
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Role + department pickers, with the department list hidden for admins (who get
 *  every department implicitly). */
function EditFields({ row, departments }: { row: StaffRow; departments: Department[] }) {
  const [role, setRole] = useState(row.role);

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-ad-ink">
        Role
        <select
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="mt-1 w-full max-w-sm rounded-lg border border-ad-border bg-white p-2 text-sm font-normal text-ad-ink outline-none focus:border-ad-steel"
        >
          <option value="staff">Staff — chosen departments only</option>
          <option value="admin">Company admin — everything</option>
          <option value="superadmin">Superadmin</option>
        </select>
      </label>

      {role === "staff" && (
        <fieldset>
          <legend className="text-sm font-medium text-ad-ink">Departments</legend>
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {departments.map((d) => (
              <label key={d.slug} className="flex items-center gap-2 text-sm text-ad-ink">
                <input
                  type="checkbox"
                  name="departments"
                  value={d.slug}
                  defaultChecked={row.departments.includes(d.slug)}
                  className="size-4 rounded border-ad-border accent-ad-steel"
                />
                {d.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
