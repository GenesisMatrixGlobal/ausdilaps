"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import type { Department } from "@/lib/departments";
import { inviteStaff, type ActionResult } from "./actions";

export function InviteStaff({ departments }: { departments: Department[] }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<"staff" | "admin">("staff");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    start(async () => {
      const res = await inviteStaff(formData);
      setResult(res);
      if (res.ok) {
        setOpen(false);
        setRole("staff");
      }
    });
  }

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={buttonVariants({ variant: "accent", size: "sm" })}
        >
          Invite staff
        </button>
        {result?.ok && <p className="text-sm text-ad-steel">{result.message}</p>}
      </div>
    );
  }

  return (
    <form
      action={submit}
      className="w-full max-w-md rounded-xl border border-ad-border bg-white p-5 shadow-sm"
    >
      <h2 className="font-semibold text-ad-ink">Invite a staff member</h2>
      <p className="mt-1 text-sm text-ad-muted">
        They&rsquo;ll get an email with a sign-in link. No password to set.
      </p>

      <div className="mt-4 space-y-3">
        <label className="block text-sm font-medium text-ad-ink">
          Email
          <input
            name="email"
            type="email"
            required
            autoFocus
            placeholder="name@ausdilaps.com.au"
            className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm font-normal text-ad-ink outline-none focus:border-ad-steel"
          />
        </label>

        <label className="block text-sm font-medium text-ad-ink">
          Full name
          <input
            name="full_name"
            type="text"
            placeholder="Jane Smith"
            className="mt-1 w-full rounded-lg border border-ad-border p-2 text-sm font-normal text-ad-ink outline-none focus:border-ad-steel"
          />
        </label>

        <label className="block text-sm font-medium text-ad-ink">
          Role
          <select
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as "staff" | "admin")}
            className="mt-1 w-full rounded-lg border border-ad-border bg-white p-2 text-sm font-normal text-ad-ink outline-none focus:border-ad-steel"
          >
            <option value="staff">Staff — chosen departments only</option>
            <option value="admin">Company admin — everything, including this page</option>
          </select>
        </label>

        {role === "staff" && (
          <fieldset>
            <legend className="text-sm font-medium text-ad-ink">Departments</legend>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {departments.map((d) => (
                <label key={d.slug} className="flex items-center gap-2 text-sm text-ad-ink">
                  <input
                    type="checkbox"
                    name="departments"
                    value={d.slug}
                    className="size-4 rounded border-ad-border accent-ad-steel"
                  />
                  {d.label}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>

      {result && !result.ok && <p className="mt-3 text-sm text-ad-orange">{result.error}</p>}

      <div className="mt-5 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className={cn(
            buttonVariants({ variant: "accent", size: "sm" }),
            pending && "opacity-60"
          )}
        >
          {pending ? "Sending…" : "Send invite"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setResult(null);
          }}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
