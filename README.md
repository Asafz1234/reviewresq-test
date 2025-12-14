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
