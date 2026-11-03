# Guests send recordings to the host; the host's browser saves every take to Google Drive

Every guest's Recording travels peer-to-peer to the host automatically, in the background while recording (throttled so the call always wins), and resumes after interruptions. Cloud storage is used only from the host's browser: once the host connects their own Google Drive, every Ready Recording is copied there, the host's own takes (solo included) as well as every guest's. We dropped the bring-your-own S3-compatible bucket, where guests uploaded directly with presigned URLs, because setting up a bucket, a scoped key and a CORS rule is too much to ask of podcasters, while signing in to Google is not. Guests never touch cloud storage.

## Considered options

- **Bring-your-own S3 bucket with direct guest uploads (the Sketch's earlier decision):** rejected for its setup burden. Its one advantage, that the host's tab need not stay open while guests upload, is lost; see Consequences.
- **Send only after the recording stops:** rejected because an hour-long recording is several gigabytes, which on home internet can take 30+ minutes after the interview with both tabs open.
- **Drive as an option alongside S3:** rejected to keep one cloud path to build and support. It can come back if users ask.

## Consequences

- **The host's tab is the hub.** Guest transfers need it open. If it closes, transfers pause and resume when it returns, or through the guest's rescue link (Hard parts §5.6); guests keep their local copy until the host confirms receipt.
- **A take is Backed up once it is in the connected Drive** (or downloaded).
- **The project needs a Google OAuth app registration** (consent screen and brand verification), shipped as a client ID in the static site. Users need a Google account but no Plowshare account. Use the `drive.file` scope (only files the app created) to avoid Google's restricted-scope review.
- **To verify when building:** browser-only token lifetime against hour-long, multi-gigabyte resumable uploads; behavior when the token expires mid-upload; Drive storage quota errors.
- Drive saving is wanted for solo takes too, so it lands before phase 4 (tracked as a follow-up to phase 1), not in phase 5.
