"use client";

import { useState } from "react";
import Script from "next/script";
import { useForm, type UseFormRegister } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  INQUIRY_TYPES,
  PROPERTY_ROLES,
  CONTACT_METHODS,
  AU_STATES,
  ASSET_COUNT_RANGES,
  type InquiryType,
} from "@/lib/leads";

type FormValues = {
  inquiryType: InquiryType | "";
  name: string;
  email: string;
  phone: string;
  role: string;
  company: string;
  projectName: string;
  // "New Quote" — structured project address
  projectAddressLine: string;
  projectAddressSuburb: string;
  projectAddressState: string;
  projectAddressPostcode: string;
  assetCount: string;
  propertyRole: string;
  projectNumber: string;
  documentId: string;
  // "I Received An Access Letter" — the enquirer's own address
  contactAddress: string;
  // "Report Inquiry" / "General Inquiry" — structured address
  addressLine: string;
  addressSuburb: string;
  addressState: string;
  addressPostcode: string;
  contactMethod: string[];
  notes: string;
  company_website: string; // honeypot
};

const inputCls =
  "mt-1.5 w-full rounded-md border border-ad-border bg-white px-4 py-2.5 text-[0.95rem] text-ad-ink placeholder:text-ad-muted/60 focus:border-ad-accent focus:outline-none focus:ring-2 focus:ring-ad-accent/30";
const labelCls = "block text-sm font-medium text-ad-ink";

function composeAddress(line: string, suburb: string, state: string, postcode: string) {
  return [line.trim(), [suburb.trim(), state.trim(), postcode.trim()].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
}

/** Standard AU address section, reused for the project address (New Quote)
 *  and the enquiry address (Report Inquiry / General Inquiry). */
function AddressFields({
  register,
  namePrefix,
  label = "Address",
}: {
  register: UseFormRegister<FormValues>;
  namePrefix: "project" | "";
  label?: string;
}) {
  const line = namePrefix === "project" ? "projectAddressLine" : "addressLine";
  const suburb = namePrefix === "project" ? "projectAddressSuburb" : "addressSuburb";
  const state = namePrefix === "project" ? "projectAddressState" : "addressState";
  const postcode = namePrefix === "project" ? "projectAddressPostcode" : "addressPostcode";

  return (
    <div className="sm:col-span-2">
      <label className={labelCls} htmlFor={line}>
        {label}
      </label>
      <input id={line} placeholder="Street address" className={inputCls} {...register(line)} />
      <div className="mt-4 grid grid-cols-[2fr_1fr_1fr] gap-4">
        <div>
          <label className={labelCls} htmlFor={suburb}>
            Suburb
          </label>
          <input id={suburb} className={inputCls} {...register(suburb)} />
        </div>
        <div>
          <label className={labelCls} htmlFor={state}>
            State
          </label>
          <select id={state} className={inputCls} defaultValue="" {...register(state)}>
            <option value="" disabled>
              —
            </option>
            {AU_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor={postcode}>
            Postcode
          </label>
          <input id={postcode} inputMode="numeric" maxLength={4} className={inputCls} {...register(postcode)} />
        </div>
      </div>
    </div>
  );
}

export function QuoteForm() {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [serverError, setServerError] = useState("");

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const inquiryType = watch("inquiryType");

  async function onSubmit(values: FormValues) {
    setStatus("idle");
    setServerError("");
    const turnstileToken =
      (document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | null)?.value ?? "";
    try {
      const projectLocation = composeAddress(
        values.projectAddressLine,
        values.projectAddressSuburb,
        values.projectAddressState,
        values.projectAddressPostcode
      );
      const contactAddress =
        values.inquiryType === "I Received An Access Letter"
          ? values.contactAddress
          : composeAddress(values.addressLine, values.addressSuburb, values.addressState, values.addressPostcode);

      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          projectLocation,
          contactAddress,
          turnstileToken,
          sourcePage: typeof window !== "undefined" ? window.location.pathname : "",
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setStatus("success");
        reset();
      } else {
        setStatus("error");
        setServerError(data.error ?? "Something went wrong. Please try again or call us.");
      }
    } catch {
      setStatus("error");
      setServerError("Network error. Please try again or call us on 1800 345 277.");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-xl border border-ad-border bg-white p-8 text-center">
        <div className="rule-accent mx-auto mb-5 w-12" />
        <h3 className="font-heading text-2xl font-semibold text-ad-ink">Request received.</h3>
        <p className="mx-auto mt-3 max-w-md text-ad-muted">
          Thanks — we&apos;ve got your details and will come back to you shortly.
          If it&apos;s urgent, call us on{" "}
          <a href="tel:1800345277" className="font-medium text-ad-accent">
            1800 345 277
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="rounded-xl border border-ad-border bg-white p-6 sm:p-8">
      {/* Honeypot — hidden from users, catches bots */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-[-9999px]" tabIndex={-1}>
        <label>
          Company website
          <input type="text" tabIndex={-1} autoComplete="off" {...register("company_website")} />
        </label>
      </div>

      {/* Step 1 — what is this about? Everything below reacts to this. */}
      <div>
        <label className={labelCls} htmlFor="inquiryType">
          What&apos;s this about? <span className="text-ad-orange">*</span>
        </label>
        <select
          id="inquiryType"
          className={cn(inputCls, errors.inquiryType && "border-ad-orange")}
          defaultValue=""
          {...register("inquiryType", { required: "Please choose an option" })}
        >
          <option value="" disabled>
            — Select an option —
          </option>
          {INQUIRY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {errors.inquiryType && <p className="mt-1 text-xs text-ad-orange">{errors.inquiryType.message}</p>}
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="name">
            Name <span className="text-ad-orange">*</span>
          </label>
          <input
            id="name"
            className={cn(inputCls, errors.name && "border-ad-orange")}
            {...register("name", { required: "Please enter your name" })}
          />
          {errors.name && <p className="mt-1 text-xs text-ad-orange">{errors.name.message}</p>}
        </div>
        <div>
          <label className={labelCls} htmlFor="email">
            Email <span className="text-ad-orange">*</span>
          </label>
          <input
            id="email"
            type="email"
            className={cn(inputCls, errors.email && "border-ad-orange")}
            {...register("email", {
              required: "Enter your email",
              pattern: { value: /.+@.+\..+/, message: "Enter a valid email address" },
            })}
          />
          {errors.email && <p className="mt-1 text-xs text-ad-orange">{errors.email.message}</p>}
        </div>
        <div>
          <label className={labelCls} htmlFor="phone">
            Phone
          </label>
          <input id="phone" type="tel" className={inputCls} {...register("phone")} />
        </div>
      </div>

      {/* Step 2 — branch-specific fields */}
      {inquiryType === "New Quote" && (
        <div className="mt-5 grid gap-5 border-t border-ad-border pt-5 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="role">
              Your role
            </label>
            <input
              id="role"
              placeholder="e.g. Contracts Administrator"
              className={inputCls}
              {...register("role")}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="company">
              Company
            </label>
            <input id="company" className={inputCls} {...register("company")} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="projectName">
              Project name
            </label>
            <input id="projectName" className={inputCls} {...register("projectName")} />
          </div>
          <AddressFields register={register} namePrefix="project" label="Project address" />
          <div>
            <label className={labelCls} htmlFor="assetCount">
              Approx. assets requiring inspection
            </label>
            <select id="assetCount" className={inputCls} defaultValue="" {...register("assetCount")}>
              <option value="" disabled>
                — Select an option —
              </option>
              {ASSET_COUNT_RANGES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {inquiryType === "I Received An Access Letter" && (
        <div className="mt-5 grid gap-5 border-t border-ad-border pt-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="propertyRole">
              Are you a tenant at this address, or the property owner? <span className="text-ad-orange">*</span>
            </label>
            <select
              id="propertyRole"
              className={cn(inputCls, errors.propertyRole && "border-ad-orange")}
              defaultValue=""
              {...register("propertyRole", { required: "Please select an option" })}
            >
              <option value="" disabled>
                — Select an option —
              </option>
              {PROPERTY_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {errors.propertyRole && <p className="mt-1 text-xs text-ad-orange">{errors.propertyRole.message}</p>}
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="contactAddress">
              Your address <span className="text-ad-orange">*</span>
            </label>
            <input
              id="contactAddress"
              placeholder="Street, suburb, state, postcode"
              className={cn(inputCls, errors.contactAddress && "border-ad-orange")}
              {...register("contactAddress", { required: "Please enter your address" })}
            />
            {errors.contactAddress && <p className="mt-1 text-xs text-ad-orange">{errors.contactAddress.message}</p>}
          </div>
        </div>
      )}

      {inquiryType === "Report Inquiry" && (
        <div className="mt-5 grid gap-5 border-t border-ad-border pt-5 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="projectNumber">
              Project / OPT number
            </label>
            <input
              id="projectNumber"
              placeholder="OPT-XXXXX"
              className={inputCls}
              {...register("projectNumber")}
            />
            <p className="mt-1.5 text-xs text-ad-muted">
              If this is an existing project and you know the OPT number, please provide it.
            </p>
          </div>
          <div>
            <label className={labelCls} htmlFor="documentId">
              Document ID
            </label>
            <input id="documentId" className={inputCls} {...register("documentId")} />
            <p className="mt-1.5 text-xs text-ad-muted">Found on the front page of your report, where accessible.</p>
          </div>
          <AddressFields register={register} namePrefix="" />
        </div>
      )}

      {inquiryType === "General Inquiry" && (
        <div className="mt-5 grid gap-5 border-t border-ad-border pt-5 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="projectNumber">
              Project / OPT number
            </label>
            <input
              id="projectNumber"
              placeholder="OPT-XXXXX (if known)"
              className={inputCls}
              {...register("projectNumber")}
            />
          </div>
          <AddressFields register={register} namePrefix="" />
        </div>
      )}

      <div className="mt-5 border-t border-ad-border pt-5">
        <label className={labelCls} htmlFor="notes">
          Message
        </label>
        <textarea id="notes" rows={4} className={inputCls} {...register("notes")} />
      </div>

      <fieldset className="mt-5">
        <legend className={labelCls}>How would you like us to get in touch?</legend>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          {CONTACT_METHODS.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm text-ad-ink">
              <input
                type="checkbox"
                value={m}
                className="h-4 w-4 rounded border-ad-border text-ad-accent focus:ring-ad-accent/30"
                {...register("contactMethod")}
              />
              {m}
            </label>
          ))}
        </div>
      </fieldset>

      {siteKey && (
        <>
          <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
          <div className="cf-turnstile mt-5" data-sitekey={siteKey} />
        </>
      )}

      {status === "error" && (
        <p className="mt-5 rounded-md border border-ad-orange/40 bg-ad-orange/5 px-4 py-3 text-sm text-ad-orange">
          {serverError}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" variant="accent" className={cn(isSubmitting && "opacity-70")}>
          {isSubmitting ? "Sending…" : "Submit"}
        </Button>
      </div>
    </form>
  );
}
