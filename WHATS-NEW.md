# What's New — Multi-Organization Support (Chunk A1)

A plain-language summary of what was just added, and exactly what to put in your
`.env` file.

> Status: built and tested (type-check + build + 31/31 tests pass). Nothing is
> committed to git yet. The old single-organization setup still works exactly as
> before — this update is additive and does not break anything.

---

## 1. What we added (in simple terms)

1. **Connect many Azure DevOps organizations.**
   Before, the app talked to **one** Azure org (set in `.env`). Now you can
   connect **as many organizations as you want** from inside the app.

2. **Each organization keeps its own access token (PAT), stored safely.**
   When you add an organization you give it a PAT. We **encrypt it** before
   saving, and we **never show it back** — only the last 4 characters.

3. **The token is checked before we save it.**
   When you add (or change) a PAT, we make a quick test call to Azure. If the
   token is wrong or expired, the app refuses to save it and tells you.

4. **Auto-import the structure of each organization.**
   With one button (one API call) we pull in that org's **Projects →
   Repositories → Teams (and team members)** and store them. This is the
   foundation for the company / org / project / team / developer dashboards.

5. **Every database record now has created & updated timestamps.**
   As requested, all collections now record when each entry was created and last
   updated.

---

## 2. New things you can call (API)

All of these are **admin-only**. Base path: `/api/v1`

| What you want to do | Call |
|---|---|
| Add an organization (with its PAT) | `POST /organizations` |
| See all connected organizations | `GET /organizations` |
| See one organization | `GET /organizations/:id` |
| Change name / rotate PAT / activate-deactivate | `PATCH /organizations/:id` |
| Import its projects, repos & teams from Azure | `POST /organizations/:id/sync` |
| List that org's projects | `GET /organizations/:id/projects` |
| Disconnect (deactivate) an organization | `DELETE /organizations/:id` |

**Example — add an organization:**
```json
POST /api/v1/organizations
{
  "name": "Client A",
  "orgUrl": "https://dev.azure.com/client-a",
  "pat": "your-azure-personal-access-token",
  "clientName": "Client A Pvt Ltd"
}
```
Then call `POST /api/v1/organizations/<id>/sync` to pull in its projects, repos,
and teams.

---

## 3. What to put in your `.env` file

**Good news:** this update needs **no brand-new variables**. But one required
variable was missing from the example file and must be present, because it is
what encrypts the organization PATs.

### ➕ Add this (required, was missing):
```env
# Minimum 16 characters. Encrypts saved PATs and webhook data.
# Keep it stable — changing it makes already-saved PATs unreadable.
ENCRYPTION_KEY=change_me_to_a_long_random_secret
```

### ✅ Keep these as they already are:
```env
# Database
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=dev_analytics

# Azure DevOps (legacy single-org — still required for now, optional later)
AZURE_ORG_URL=https://dev.azure.com/your-organisation
AZURE_PAT=your_personal_access_token_here
AZURE_WEBHOOK_SECRET=your_webhook_shared_secret_here
```

> **Note:** `AZURE_ORG_URL` and `AZURE_PAT` are still required by the current
> config check, so leave them in for now. From the next update (Chunk A2) the
> per-organization PATs you add in-app fully replace them, and these become
> optional.

A full, ready-to-copy template lives in **`.env.example`**.

---

## 4. Quick start (first organization)

1. Make sure your `.env` has `ENCRYPTION_KEY` set (see above).
2. Start the backend as usual.
3. Log in as an **admin** and call `POST /api/v1/organizations` with the org URL
   and its PAT.
4. Call `POST /api/v1/organizations/<id>/sync` to import its projects, repos, and
   teams.
5. Repeat for each client/organization.

---

## 5. What is NOT done yet (coming in Chunk A2)

- Incoming Azure **webhooks are not yet split per organization** — that route
  (`/webhooks/azure/:orgId`) and per-org signature checking are next.
- Incoming commits / pull requests / work items are **not yet stamped with which
  organization they belong to** — that wiring is the next step.

These don't affect anything you have today; they're the next planned increment.

---

## 6. Where the full technical plan lives

The complete architecture and the 6-chunk roadmap:
**`docs/architecture/realtime-analytics-redesign.md`**
