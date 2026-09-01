# Tender Watch — mailbox access setup

**For whoever administers AusDilaps' Microsoft 365 tenant.** Forward this whole file.

We have a service that reads **`tenders@ausdilaps.com.au`** once a night, classifies tender
notifications, and emails the relevant ones to our estimating team. It needs read access to
that one mailbox and nothing else.

Requires **Exchange Administrator** in Entra, and membership of the **Organization
Management** role group in Exchange Online.

---

## Please use RBAC for Applications, not Application Access Policies

Microsoft [replaced Application Access Policies with RBAC for
Applications](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac).
The older `New-ApplicationAccessPolicy` approach still functions but is the superseded path.

**The trap worth knowing about:** the two permission systems are **additive**. If the app
has `Mail.Read` consented in Entra ID *and* a resource-scoped `Mail.Read` in Exchange RBAC,
the Entra grant wins and the app reads **every mailbox in the tenant**. Microsoft's own docs
call this out. So the Entra grant must not be there — step 2 below.

---

## 1. Register the app

**→ [Entra ID → App registrations → New registration](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade)**

- Name: `AusDilaps Tender Watch`
- Accounts in this organizational directory only (single tenant)
- No redirect URI — it never signs a user in

Then **Certificates & secrets → New client secret**, 24 months. Copy the **Value** (not the
Secret ID) — it is shown once.

## 2. Do NOT grant Mail.Read in Entra

Leave **API permissions** empty. If `Mail.Read` is already there, remove it — see the note
above about the two systems being additive.

## 3. Get the IDs from Enterprise applications

**→ [Entra ID → Enterprise applications](https://entra.microsoft.com/#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade/~/AppAppsPreview)** → search `AusDilaps Tender Watch`

Take the **Application ID** and the **Object ID** from *this* page.

> ⚠️ The App registrations page shows a **different** Object ID. Microsoft's docs flag this
> specifically. The one from Enterprise applications is the service principal's, which is
> what `New-ServicePrincipal` needs.

## 4. Scope it to the one mailbox

Run in Exchange Online PowerShell. Only the two variables at the top need filling in.

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser -Force   # first time only
Connect-ExchangeOnline

# ── from Entra → Enterprise applications (step 3) ──
$AppId    = "<Application ID>"
$ObjectId = "<Object ID>"
$Mailbox  = "tenders@ausdilaps.com.au"

# Point Exchange at the Entra app
New-ServicePrincipal -AppId $AppId -ObjectId $ObjectId -DisplayName "AusDilaps Tender Watch"

# Build a scope and CHECK IT FIRST — this must list exactly one mailbox
$Filter = "PrimarySmtpAddress -eq '$Mailbox'"
Get-Recipient -RecipientPreviewFilter $Filter | Select-Object DisplayName, PrimarySmtpAddress
# If that filter isn't supported in your tenant, "Alias -eq 'tenders'" is the usual fallback.

New-ManagementScope -Name "TenderWatch-mailbox" -RecipientRestrictionFilter $Filter

# Grant read on that scope only
New-ManagementRoleAssignment -App $ObjectId `
  -Role "Application Mail.Read" -CustomResourceScope "TenderWatch-mailbox"
```

## 5. Prove it is actually restricted

```powershell
Test-ServicePrincipalAuthorization -Identity $AppId -Resource $Mailbox | Format-Table
Test-ServicePrincipalAuthorization -Identity $AppId -Resource "<any other staff mailbox>" | Format-Table
```

- First command → `InScope` **True**
- Second command → `InScope` **False**

If the second says True, the Entra grant from step 2 is still in place.

> Permission changes cache for **30 minutes to 2 hours**. `Test-ServicePrincipalAuthorization`
> bypasses that cache, so trust it over a live API call made immediately after the change.

## 6. Send back

1. **Directory (tenant) ID**
2. **Application (client) ID**
3. **Client secret value** — via 1Password/LastPass or similar, not email
4. The output of step 5

---

## What we do with it

Stored as `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID` and `MS_GRAPH_CLIENT_SECRET` in Vercel's
encrypted environment variables, server-side only — never sent to a browser.

Before trusting it we run our own independent check (`assertMailboxScoped()` in
`lib/tenders/sources/mailbox.ts`) that requests a *different* mailbox and confirms it gets a
**403**. If it doesn't, we stop and come back to you.

The app only ever reads. It cannot send, delete, or modify anything.
