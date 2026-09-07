# Sync To Salesforce — setup reference

The **Sync To Salesforce** button on the markup tools (Building Markup, Road Markup and
Measure) files a generated PNG into Box and links it onto the Quote — or onto a single Quote
Line Item. It also files the tool's `.json` save file beside the PNG. This is the reference
for what it's called and where it's configured, so nobody has to re-derive it.

## The Salesforce app

**Name:** `AusDilaps Website Integration`
**Type:** External Client App — *not* a legacy Connected App. Setup → App Manager shows both;
this one only appears under **External Client Apps**.
**Id:** `0xIOl0000000aptMAA`
**Flow:** OAuth 2.0 client credentials (server-to-server, no user login).
**Run-as user:** `rhys@ausdilaps.com.au` — the app's permissions are this user's permissions.
**Scope:** `Api` ("Manage user data via APIs"). Nothing else is needed; the app only reads
Quote/Opportunity and writes one Quote field.

Not to be confused with **`Survey_Headings_Web_App`** (`0xIOl0000000XgjMAE`), which is the
Excel row importer. It uses the JWT bearer flow (`SF_SURVEY_*` env vars) and is unrelated.

### Required policy settings

The app is created with client credentials **off** by default, and the token call fails with a
generic `invalid_grant` until all three are set on its OAuth policy:

| Setting | Required value |
|---|---|
| Enable Client Credentials Flow | on |
| Run As user | `rhys@ausdilaps.com.au` |
| IP Relaxation | Relax IP restrictions |

IP relaxation matters because Vercel's serverless IPs are neither static nor trusted-range.

## Environment variables

| Variable | Value |
|---|---|
| `SF_CLIENT_ID` | The app's Consumer Key |
| `SF_CLIENT_SECRET` | The app's Consumer Secret — only readable in the Salesforce UI, never via API |
| `SF_LOGIN_URL` | **`https://ausdilaps.my.salesforce.com`** — must be the My Domain host, see below |
| `BOX_CLIENT_ID` / `BOX_CLIENT_SECRET` / `BOX_ENTERPRISE_ID` | Box Custom App (Client Credentials Grant) |

### The My Domain requirement

The client credentials flow will **not** work against `login.salesforce.com`. It fails with:

    invalid_grant: request not supported on this domain

Salesforce requires client-credentials token requests to go to the org's My Domain host, so
`SF_LOGIN_URL` must be `https://ausdilaps.my.salesforce.com`. Leaving it unset falls back to
`login.salesforce.com` and fails. For a sandbox, use that sandbox's own My Domain host, not
`test.salesforce.com`.

This error is easy to misread as a permissions problem — it is not. If the three policy
settings above are correct and the token call still 400s, check the domain first.

The Box app needs **Write all files and folders**, re-authorised by a Box admin, and its
service account needs **Editor** on the Opportunity folder tree. Viewer cannot upload.

`MARKUP_SYNC_ALLOW_UNAUTHED` exists for local testing only. Never set it in production.

## Salesforce fields it touches

Reads `Opportunity.Link_to_Box_Files__c` (via the Quote's parent) to find the Box folder, then
traverses `2. Estimations` → `Site Markup`.

Note that field holds Box **embed** URLs, not plain folder links:

    https://ausdilaps.app.box.com/embed/folder/407915747083?partner_id=219&promoted_app_ids=840%2C1476

`parseBoxFolderId` accepts any number of path segments before `folder/<id>` for that reason.

Writes to the Quote's markup slots. **There are five**, and they are used in practice — most
Quotes already have slot 1 filled and 29 use all five, so the sync writes to the first *empty*
slot and refuses to overwrite:

| Slot | URL field | Name field |
|---|---|---|
| 1 | `Site_Mark_Up__c` | `Site_Mark_Up_1_Name__c` |
| 2 | `Site_Mark_Up_2__c` | `Site_Mark_Up_2_Name__c` |
| 3 | `Site_Mark_Up_3__c` | `Site_Mark_Up_3_Name__c` |
| 4 | `Site_Mark_Up_4__c` | `Site_Mark_Up_4_Name__c` |
| 5 | `Site_Mark_Up_5__c` | `Site_Mark_Up_5_Name__c` |

Slot 1's URL field has no `1` in it while its name field does. That asymmetry is real.

The UI shows which slot it will use before you upload. When all five are full it uploads to Box
and tells you to clear a slot — it does not silently drop the link.

Box shared links are **company-scoped**, not public: a job document, unlike the marketing
samples library, which is deliberately `open`.

### Quote Line Items

Paste a **Quote Line Item** URL instead of a Quote URL and the link is written to that line
item's own field rather than a Quote slot:

| | |
|---|---|
| Object | `QuoteLineItem` |
| Field | `Line_Item_Mark_Up__c` |
| Count | **One**, not five — so a filled field is refused, never overwritten |

The file still lands in the **Quote's** Box folder: a line item has no folder of its own, so
`resolveLineItem()` walks up to `QuoteId` and the whole existing chain
(`Opportunity.Link_to_Box_Files__c` → `2. Estimations` → `Site Markup`) runs unchanged. The
suggested filename gains the line item, e.g. `Q-01234 - Some Opp - Line 3 - Dilapidation
Survey - Site Markup.png`.

**Detection** is by the object name in a Lightning URL when present, falling back to the
Salesforce key prefix (`0QL` = QuoteLineItem) for a bare pasted Id. Getting it wrong means
the record isn't found — a clear error, never a write to the wrong place. A Quote URL, a
Quote number, a bare Quote Id and a Quote's related-list URL all still resolve to the Quote.

### The .json companion

Every sync also uploads the tool's save file next to the PNG, sharing its filename stem, so
whoever picks the job up can reopen and adjust the markup instead of redrawing from a
flattened image. Building Markup's carries the resolved cadastre geometry; Measure's carries
the measurements and the frame.

It is **never** linked to a markup slot or to `Line_Item_Mark_Up__c` — those fields hold an
image URL that Salesforce's document merge fetches expecting renderable bytes, and a `.json`
in one would merge a broken image.

A companion failure is **reported, never thrown**. The PNG is already filed and possibly
already linked, so failing the whole sync over the companion would have the operator
re-uploading a markup that is sitting in Box correctly.
