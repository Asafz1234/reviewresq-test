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

## Customer sources and Firestore schema

ReviewResQ now centralizes every inbound customer record under a unified `customerSources` flow so that requests, follow-ups, and automations share the same Firestore documents.

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
}
```

`createdAt` is set on first write; `lastInteractionAt` updates each time a new source delivers the customer.
