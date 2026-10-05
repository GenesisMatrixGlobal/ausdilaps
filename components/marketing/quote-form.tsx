"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { useForm, useWatch, type UseFormRegister } from "react-hook-form";
import { Check, FileText, MailOpen, MessageCircle, ClipboardList, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
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

/** Visitor-facing labels share the existing API enquiry types. Access-letter
 *  enquiries lead the choices so residents can quickly find their way in. */
const TYPE_OPTIONS: { value: InquiryType; label: string; hint: string; cta: string; icon: LucideIcon }[] = [
  {
    value: "I Received An Access Letter",
    label: "Access letter",
    hint: "Received a letter? Share your address and any questions, and we\u2019ll help with the next steps.",
    cta: "Send enquiry",
    icon: MailOpen,
  },
  {
    value: "New Quote",
    label: "Request a quote",
    hint: "Tell us about your project and we\u2019ll help you get a quote.",
    cta: "Request a quote",
    icon: ClipboardList,
  },
  {
    value: "Report Inquiry",
    label: "Report question",
    hint: "Share your question and a project reference, if you have one.",
    cta: "Send message",
    icon: FileText,
  },
  {
    value: "General Inquiry",
    label: "Something else",
    hint: "Leave us a message and we\u2019ll be happy to help.",
    cta: "Send message",
    icon: MessageCircle,
  },
];

const inputCls =
  "mt-1.5 w-full rounded-md border border-ad-border bg-white px-4 py-2.5 text-[0.95rem] text-ad-ink placeholder:text-ad-muted/60 focus:border-ad-accent focus:outline-none focus:ring-2 focus:ring-ad-accent/30";
const labelCls = "block text-sm font-medium text-ad-ink";

function composeAddress(
  line: string | undefined,
  suburb: string | undefined,
  state: string | undefined,
  postcode: string | undefined
) {
  const s = (v: string | undefined) => (v ?? "").trim();
  return [s(line), [s(suburb), s(state), s(postcode)].filter(Boolean).join(" ")]
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
      <input id={line} placeholder="Street address" autoComplete="address-line1" className={inputCls} {...register(line)} />
      <div className="mt-4 grid grid-cols-[2fr_1fr_1fr] gap-4">
        <div>
          <label className={labelCls} htmlFor={suburb}>
            Suburb
          </label>
          <input id={suburb} autoComplete="address-level2" className={inputCls} {...register(suburb)} />
        </div>
        <div>
          <label className={labelCls} htmlFor={state}>
            State
          </label>
          <select id={state} autoComplete="address-level1" className={inputCls} defaultValue="" {...register(state)}>
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
          <input id={postcode} inputMode="numeric" maxLength={4} autoComplete="postal-code" className={inputCls} {...register(postcode)} />
        </div>
      </div>
    </div>
  );
}

/** "How would you like us to get in touch?" — SMS / Call / Email, shared by both variants. */
function ContactMethodField({
  register,
  className,
}: {
  register: UseFormRegister<FormValues>;
  className?: string;
}) {
  return (
    <fieldset className={className}>
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
  );
}

/**
 * `variant="full"` is the /quote page: every field, branched by enquiry type.
 * `variant="compact"` is the homepage hero card: contact details and the relevant
 * project or enquiry fields, including asset count for quotes and the required
 * property role for an access-letter enquiry. Same API,
 * same validation, same routing — the compact form is a shorter way into the same
 * `/api/quote`, never a second lead path.
 */
export function QuoteForm({ variant = "full" }: { variant?: "full" | "compact" } = {}) {
  const compact = variant === "compact";
  const {
    register,
    handleSubmit,
    reset,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    // Every field needs a default. react-hook-form only registers what is rendered,
    // and the form shows a different address block per enquiry type — so without
    // these, the block that ISN'T shown arrives as `undefined` and composeAddress
    // throws on `.trim()` before the fetch ever runs. That threw on every enquiry
    // type, in every browser, and the catch below reported it as "Network error".
    defaultValues: {
      inquiryType: "",
      name: "",
      email: "",
      phone: "",
      role: "",
      company: "",
      projectName: "",
      projectAddressLine: "",
      projectAddressSuburb: "",
      projectAddressState: "",
      projectAddressPostcode: "",
      assetCount: "",
      propertyRole: "",
      projectNumber: "",
      documentId: "",
      contactAddress: "",
      addressLine: "",
      addressSuburb: "",
      addressState: "",
      addressPostcode: "",
      contactMethod: [],
      notes: "",
      company_website: "",
    },
  });
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [serverError, setServerError] = useState("");
  const successRef = useRef<HTMLDivElement>(null);

  // Bring the confirmation into view. The form is long enough that submitting from
  // the bottom otherwise leaves the success panel off-screen and looks like nothing
  // happened. Declared before the early return below — hooks can't live after it.
  useEffect(() => {
    if (status !== "success") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    successRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "center",
    });
  }, [status]);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const inquiryType = useWatch({ control, name: "inquiryType" });

  async function onSubmit(values: FormValues) {
    setStatus("idle");
    setServerError("");
    const turnstileToken =
      (document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | null)?.value ?? "";
    try {
      // The compact form has ONE free-text address field (held in `contactAddress`);
      // for a New Quote it is the project's location, for everything else the
      // enquirer's own address — the same two columns the full form fills.
      const isNewQuote = values.inquiryType === "New Quote";
      const projectLocation = compact
        ? isNewQuote
          ? values.contactAddress
          : ""
        : composeAddress(
            values.projectAddressLine,
            values.projectAddressSuburb,
            values.projectAddressState,
            values.projectAddressPostcode
          );
      const contactAddress = compact
        ? isNewQuote
          ? ""
          : values.contactAddress
        : values.inquiryType === "I Received An Access Letter"
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
          sourcePage:
            typeof window !== "undefined" ? `${window.location.pathname}${compact ? "#quote" : ""}` : "",
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setStatus("success");
        reset();
      } else {
        setStatus("error");
        // The route answers a validation failure with per-field `errors`, but this
        // only ever read `error` (singular) — so a rejected field showed as a generic
        // "something went wrong" with no clue which one. Put them back on the fields.
        const fieldErrors = data.errors as Record<string, string[]> | undefined;
        if (fieldErrors) {
          for (const [field, messages] of Object.entries(fieldErrors)) {
            if (messages?.[0]) {
              setError(field as keyof FormValues, { type: "server", message: messages[0] });
            }
          }
          setServerError("Please check the highlighted fields and try again.");
        } else {
          setServerError(data.error ?? "Something went wrong. Please try again or call us.");
        }
      }
    } catch (e) {
      // This catch covers the whole body, not just the fetch — a client-side throw
      // in here used to be reported to the user as a network problem and left no
      // trace anywhere. Log it so the next fault is diagnosable from the console.
      console.error("[quote] submit failed:", e);
      setStatus("error");
      setServerError("Something went wrong. Please try again or call us on 1800 345 277.");
    }
  }

  if (status === "success") {
    return (
      <div
        ref={successRef}
        role="status"
        aria-live="polite"
        className="ad-success rounded-xl border border-ad-green-line bg-ad-green-tint p-8 text-center"
      >
        <svg
          viewBox="0 0 56 56"
          className="mx-auto mb-5 h-14 w-14 text-ad-green"
          fill="none"
          aria-hidden="true"
        >
          <circle
            className="ad-success-ring"
            cx="28"
            cy="28"
            r="26.5"
            stroke="currentColor"
            strokeWidth="2"
            opacity="0.45"
          />
          <path
            className="ad-success-tick"
            d="M17 28.5 L24.5 36 L39 21"
            stroke="currentColor"
            strokeWidth="3.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <h3 className="font-heading text-2xl font-semibold text-ad-ink">Thanks for getting in touch.</h3>
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

  const honeypot = (
    // Keep it out of browser autofill as well as the visual layout. Off-screen
    // text fields can still be autofilled and silently reject a real enquiry.
    <div hidden aria-hidden="true" tabIndex={-1}>
      <label>
        Company website
        <input type="text" tabIndex={-1} autoComplete="off" {...register("company_website")} />
      </label>
    </div>
  );

  if (compact) {
    const selected = TYPE_OPTIONS.find((o) => o.value === inquiryType);
    const isNewQuote = inquiryType === "New Quote";
    const isAccessLetter = inquiryType === "I Received An Access Letter";
    const isReport = inquiryType === "Report Inquiry";
    const isGeneral = inquiryType === "General Inquiry";
    return (
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="relative rounded-xl border border-ad-steel/15 bg-white p-6 shadow-xl shadow-ad-steel/10 sm:p-7"
      >
        {honeypot}

        {/* Give the enquiry choices visual priority before the contact details. */}
        <fieldset className="min-w-0" aria-describedby="enquiry-hint">
          <legend className="max-w-full">
            <h2 className="font-heading text-2xl font-semibold tracking-tight text-ad-steel-dark">
              How can we help you?
            </h2>
          </legend>
          <div className="mt-3 grid grid-cols-1 gap-2.5 min-[375px]:grid-cols-2">
            {TYPE_OPTIONS.map((o) => {
              const Icon = o.icon;
              return (
                <label key={o.value} className="group cursor-pointer">
                  <input
                    type="radio"
                    value={o.value}
                    className="peer sr-only"
                    aria-describedby={errors.inquiryType ? "enquiry-error" : undefined}
                    {...register("inquiryType", { required: "Please choose one of the options" })}
                  />
                  <span
                    className={cn(
                      "relative flex min-h-16 items-center gap-2.5 rounded-lg border bg-ad-sky py-3 pl-3 pr-7 text-sm font-medium leading-snug text-ad-steel-dark transition-colors group-hover:border-ad-accent/70 group-hover:bg-ad-sky-deep",
                      "peer-checked:border-ad-accent peer-checked:bg-ad-accent peer-checked:text-white",
                      "peer-focus-visible:ring-2 peer-focus-visible:ring-ad-accent peer-focus-visible:ring-offset-2",
                      "[&_.choice-check]:opacity-0 peer-checked:[&_.choice-check]:opacity-100",
                      errors.inquiryType ? "border-ad-orange/60" : "border-ad-accent/30"
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <span>{o.label}</span>
                    {/* Positioned, not inline, so the tick never changes how the label wraps. */}
                    <Check
                      className="choice-check absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 transition-opacity"
                      aria-hidden="true"
                    />
                  </span>
                </label>
              );
            })}
          </div>
          {errors.inquiryType && <p id="enquiry-error" className="mt-2 text-xs text-ad-orange">{errors.inquiryType.message}</p>}
          <p id="enquiry-hint" className="mt-3 text-sm leading-relaxed text-ad-muted" aria-live="polite">
            {selected ? selected.hint : "Choose an option and we\u2019ll guide you from there."}
          </p>
        </fieldset>

        <div className="mt-5 space-y-4 border-t border-ad-border pt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="name">
                Name <span className="text-ad-orange">*</span>
              </label>
              <input
                id="name"
                autoComplete="name"
                className={cn(inputCls, errors.name && "border-ad-orange")}
                {...register("name", { required: "Please enter your name" })}
              />
              {errors.name && <p className="mt-1 text-xs text-ad-orange">{errors.name.message}</p>}
            </div>
            <div>
              <label className={labelCls} htmlFor="phone">
                Phone
              </label>
              <input id="phone" type="tel" autoComplete="tel" className={inputCls} {...register("phone")} />
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="email">
              Email <span className="text-ad-orange">*</span>
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className={cn(inputCls, errors.email && "border-ad-orange")}
              {...register("email", {
                required: "Enter your email",
                pattern: { value: /.+@.+\..+/, message: "Enter a valid email address" },
              })}
            />
            {errors.email && <p className="mt-1 text-xs text-ad-orange">{errors.email.message}</p>}
          </div>

          {isNewQuote && (
            <div>
              <label className={labelCls} htmlFor="company">
                Company
              </label>
              <input id="company" autoComplete="organization" className={inputCls} {...register("company")} />
            </div>
          )}

          {isAccessLetter && (
            <div>
              <label className={labelCls} htmlFor="propertyRole">
                Your connection to the property <span className="text-ad-orange">*</span>
              </label>
              <select
                id="propertyRole"
                className={cn(inputCls, errors.propertyRole && "border-ad-orange")}
                defaultValue=""
                {...register("propertyRole", { required: "Please select an option" })}
              >
                <option value="" disabled>
                  Please choose
                </option>
                {PROPERTY_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              {errors.propertyRole && <p className="mt-1 text-xs text-ad-orange">{errors.propertyRole.message}</p>}
            </div>
          )}

          {(isNewQuote || isAccessLetter) && (
            <div>
              <label className={labelCls} htmlFor="contactAddress">
                {isAccessLetter ? "Your address" : "Project address or suburb"}{" "}
                {isAccessLetter && <span className="text-ad-orange">*</span>}
              </label>
              <input
                id="contactAddress"
                autoComplete="street-address"
                placeholder="Street, suburb, state"
                className={cn(inputCls, errors.contactAddress && "border-ad-orange")}
                {...register("contactAddress", {
                  required: isAccessLetter ? "Please enter your address" : false,
                })}
              />
              {errors.contactAddress && (
                <p className="mt-1 text-xs text-ad-orange">{errors.contactAddress.message}</p>
              )}
            </div>
          )}

          {/* The acknowledgement email tells a resident how we'll get in touch, so the
              homepage form has to ask (Rhys, 2026-10-05) — the same field as the full form. */}
          {isAccessLetter && <ContactMethodField register={register} />}

          {isNewQuote && (
            <div>
              <label className={labelCls} htmlFor="assetCount">
                Approx. assets requiring inspection
              </label>
              <select id="assetCount" className={inputCls} defaultValue="" {...register("assetCount")}>
                <option value="" disabled>
                  Please choose
                </option>
                {ASSET_COUNT_RANGES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isReport && (
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
          )}

          {(isNewQuote || isAccessLetter || isReport || isGeneral) && (
            <div>
              <label className={labelCls} htmlFor="notes">
                Message <span className="font-normal text-ad-muted">(optional)</span>
              </label>
              <textarea
                id="notes"
                rows={2}
                placeholder={isAccessLetter ? "Any questions or access details you\u2019d like to share?" : "How can we help?"}
                className={inputCls}
                {...register("notes")}
              />
            </div>
          )}
        </div>

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

        <Button
          type="submit"
          size="lg"
          variant="accent"
          disabled={isSubmitting}
          className={cn("mt-5 w-full", isSubmitting && "opacity-70")}
        >
          {isSubmitting ? "Sending…" : (selected?.cta ?? "Send")}
        </Button>
        <p className="mt-3 text-center text-xs text-ad-muted">
          We only use your details to respond to this enquiry.{" "}
          <a href="/privacy-policy" className="font-medium text-ad-accent hover:brightness-90">
            Privacy Policy
          </a>
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="rounded-xl border border-ad-border bg-white p-6 sm:p-8">
      {/* Honeypot — hidden from users, catches bots */}
      {honeypot}

      {/* The selected enquiry type determines the fields below. */}
      <div>
        <label className={labelCls} htmlFor="inquiryType">
          How can we help you? <span className="text-ad-orange">*</span>
        </label>
        <select
          id="inquiryType"
          className={cn(inputCls, "border-ad-accent/40 bg-ad-accent/5", errors.inquiryType && "border-ad-orange")}
          defaultValue=""
          {...register("inquiryType", { required: "Please choose an option" })}
        >
          <option value="" disabled>
            Please choose an option
          </option>
          {TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
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
            autoComplete="name"
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
            autoComplete="email"
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
          <input id="phone" type="tel" autoComplete="tel" className={inputCls} {...register("phone")} />
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
              autoComplete="organization-title"
              className={inputCls}
              {...register("role")}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="company">
              Company
            </label>
            <input id="company" autoComplete="organization" className={inputCls} {...register("company")} />
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
              autoComplete="street-address"
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

      <ContactMethodField register={register} className="mt-5" />

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
        <p className="text-xs text-ad-muted">
          We use your details to respond to your enquiry. See our{" "}
          <a href="/privacy-policy" className="font-medium text-ad-accent hover:brightness-90">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </form>
  );
}
