# Ask Reviews activity + customer model notes

## Request activity collection
- Path: `businesses/{businessId}/outboundRequests`
- Key fields used by the Ask Reviews activity table:
  - `customerId` (nullable)
  - `customerName`, `customerEmail`, `customerPhone` (fallbacks when a customer doc is missing)
  - `channel` ("email" | "link" when present)
  - Email delivery markers: `provider`, `providerMessageId`, `deliveredAtMs`, `processedAtMs`
  - `sentAtMs`, `createdAtMs`, `updatedAtMs`, `openedAtMs`, `clickedAtMs`
  - `status`, `inviteToken`, `reviewLink`, `locale`, `tz`

## Customers collection
- Path (business-scoped): `businesses/{businessId}/customers`
- `customerId` from outbound requests maps to the document ID in this collection.
- Primary display fields: `name`, falling back to `email` or `phone` when `name` is missing.

