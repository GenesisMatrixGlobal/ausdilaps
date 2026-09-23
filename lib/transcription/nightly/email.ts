import "server-only";

// One Resend call, the Tender Watch way (lib/tenders/notify.ts): a missing key or a refused send
// is RETURNED, never thrown, and logged loudly — silent non-delivery is the failure a morning
// report exists to prevent. The idempotency key is what makes a re-run tick safe: Resend
// answers a repeated key with the first message instead of sending again.

export async function sendEmail(opts: {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  idempotencyKey: string;
}): Promise<{ sent: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("[transcription-nightly] RESEND_API_KEY not configured —", opts.subject);
    return { sent: false, error: "RESEND_API_KEY not configured" };
  }
  if (opts.to.length === 0) return { sent: false, error: "No recipient" };
  const from = process.env.RESEND_FROM_EMAIL ?? "AusDilaps <no-reply@ausdilaps.com.au>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": opts.idempotencyKey },
      body: JSON.stringify({ from, to: opts.to, ...(opts.cc?.length ? { cc: opts.cc } : {}), subject: opts.subject, html: opts.html }),
    });
    if (!res.ok) {
      const error = `Resend ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`;
      console.error("[transcription-nightly]", error);
      return { sent: false, error };
    }
    return { sent: true };
  } catch (e) {
    const error = (e as Error).message;
    console.error("[transcription-nightly] send failed:", error);
    return { sent: false, error };
  }
}

/** Comma-separated env list → addresses. */
export function addressList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((a) => a.trim()).filter((a) => /^[^@\s]+@[^@\s]+$/.test(a));
}
