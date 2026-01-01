# ReviewResQ Google OAuth and Places Configuration

This project uses environment variables (or Cloud Functions secrets/parameters) for all Google OAuth and Places integration. The frontend only consumes the public OAuth client ID; all secrets remain server-side.

## Deployment

Set the required environment variables before deploying Cloud Functions:

```bash
# Configure Google OAuth client details
firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_ID
firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET
firebase functions:secrets:set GOOGLE_OAUTH_REDIRECT_URI

# Configure Places/Maps access
firebase functions:secrets:set GOOGLE_PLACES_API_KEY

# Deploy functions after secrets are available
firebase deploy --only functions
```

For local emulation, create a `.env` file in the project root with the same variable names so that `process.env` resolves them during development.

### Verification

Deploying Functions should no longer prompt for `SENDGRID_SENDER`; the value is sourced from the Cloud Secret Manager secrets `SENDGRID_API_KEY` and `SENDGRID_SENDER` that must exist before deployment.

## Firebase Storage CORS for logo uploads

Logo uploads from `https://reviewresq.com` require an explicit CORS policy on the Firebase Storage bucket (`gs://reviewresq-app.firebasestorage.app`). Use the supplied `storage-cors.json` file and apply it with `gsutil`:

```bash
gsutil cors set storage-cors.json gs://reviewresq-app.firebasestorage.app
gsutil cors get gs://reviewresq-app.firebasestorage.app
```

This configuration allows both the apex and `www` domains to complete the preflight/POST flow used by `uploadBytesResumable`, enabling logo uploads without changing client-side validation or compression.

## Customer sources and Firestore schema

ReviewResQ now centralizes every inbound customer record under a unified `customerSources` flow so that requests, follow-ups, and automations share the same Firestore documents.

## Project layout

- **Frontend**: `/public` (Firebase Hosting serves files at the site root, e.g. `/portal.html` maps to `public/portal.html`).
- **Backend**: `/functions` (Firebase Functions and callable/HTTP endpoints).
- **Local scripts**: `/scripts` (utility generators like `generate-runtime-env.js`).

## Deploying from VS Code (PowerShell)

Run the frontend env build and deploy Hosting + Functions from a VS Code terminal on Windows:

```powershell
cd /path/to/reviewresq-test
npm run build:env
firebase deploy --only "hosting,functions" --project reviewresq-app
```

Supported inputs:

- Manual entry via the dashboard
- CSV upload for batch imports
  - Google Sheets sync (read-only)
  - Webhook ingestion for Zapier/Make-style connectors
  - Funnel captures from the public feedback portal

CSV uploads accept three columns (`name`, `phone`, and `email`) and run a preview step before writing to Firestore. Rows are deduplicated by phone/email (including existing customers) and tagged with `source=csv` when imported.

Each ingested customer is upserted into `customers/{customerId}` with the following fields:

```
customers/{customerId} {
  businessId
  name
  phone
  email
  source: "manual" | "csv" | "sheet" | "funnel" | "webhook"
  createdAt
  lastInteractionAt
  reviewStatus: "none" | "requested" | "reviewed" | "negative"
  archived?: boolean (soft-delete flag)
  timeline?: [
    {
      type: "sms_sent" | "email_sent" | "review_left" | "feedback_received" | "campaign_message" | "automation_step"
      timestamp
      metadata
    }
  ]
}
```

`createdAt` is set on first write; `lastInteractionAt` updates each time a new source delivers the customer. `archived` is used in place of deletions. Timeline entries capture every touchpoint (messages sent, feedback captured, review clicks) so the dashboard can render a per-customer history.

## Campaigns and flows

Campaigns target customers by status/source, select a channel (SMS/Email), choose a template, schedule, and follow-up rules.

```
campaigns/{id} {
  businessId
  audienceRules
  channel
  templateId
  templateBody
  schedule
  followUpRules
  status
  createdAt
}
```

Automation flows (Pro AI) allow triggered, multi-step journeys with messaging, waits, and branching:

```
automationFlows/{id} {
  businessId
  name
  trigger: "service_completed" | "manual"
  steps: [{ type: "send_message" | "wait" | "condition" | "branch", details }]
  updatedAt
}
```

Bulk send (Growth) uses campaign templates to batch-deliver SMS/Email in rate-limited chunks with per-recipient error logging and timeline entries for customer history.

## Lead lifecycle tracking

Leads progress through a fixed lifecycle so outreach, conversions, and review asks stay visible:

- `created` → initial capture
- `contacted` → outreach sent or call placed
- `converted` → booked/closed won
- `review_requested` → review invite sent
- `review_completed` → review received/confirmed

Status changes should be logged to the lead timeline alongside AI/user messages so the dashboard reflects every step.

## AI Agent outcomes

The Pro AI agent can answer inbound messages, draft and send review requests, summarize entire conversations, and only alert the owner when escalation is truly needed. Each AI touch should update customer timelines and, when appropriate, advance leads to `contacted`, `review_requested`, or `review_completed` states.
