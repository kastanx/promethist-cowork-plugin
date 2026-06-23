# Promethist — billing (operator guide)

What the plugin can read about an account's billing, and the hard line it does not cross. Tools (all READ-ONLY): `get_subscription`, `get_subscription_by_project`, `get_subscription_by_agent`, `list_invoices`, `get_usage`.

## The billing model

- **Conversational Minute** is the billing unit: charges accrue based on the minutes agents spend interacting with users.
- **Billing is account-level.** Usage (conversational minutes) **aggregates across all projects and agents** under an account/tenant to determine overall billing. Each account has its own billing.
- **Access is owner-gated in the app** (the Owner can manage billing; Editors/Viewers cannot manage it). The READ endpoints this plugin uses require **viewer** on the tenant/project/agent, which is enough to *read* status, invoices, and usage. You can read billing; you cannot change it.
- **Plans / subscription tiers:** **Free**, **Growth**, **Enterprise**.
  - **Free** — unlimited platform access, **60 minutes** of active conversations free, best-effort support, overage **$0.50/min**.
  - **Growth** — unlimited access, priority support, SSO & basic security, **minute-based or seat-based** volume pricing tiers, overage **$0.50/min**.
  - **Enterprise** — custom pricing, advanced security/compliance, 24/7 support & onboarding, bring-your-own LLMs, custom avatars/voices/workflows.
- **Payments are processed by Stripe**, completed by the user off-platform.

## What you can READ

- **Subscription status & plan** — `get_subscription` (by `tenant_id`), or the convenience resolvers `get_subscription_by_project` (by `project_id`) and `get_subscription_by_agent` (by `agent_id`). Returns `{id, status, description}`. `status` is the Stripe status string (`active`, `past_due`, `canceled`, …); the **current plan** is conveyed in `description`. If there's no active subscription, the status reflects that.
- **Invoices** — `list_invoices` (by `tenant_id`; `first` default 100, `starting_after` = Stripe cursor — pass the last invoice `id` to page). Each invoice: `{id, status, total, currency, created, invoicePdf?, hostedInvoiceUrl?}`.
  - **`total` is in the currency's minor unit — divide by 100** for a human amount (Stripe convention).
  - `invoicePdf` / `hostedInvoiceUrl` are **read-only view links** (safe to surface — they open an invoice, they do not change anything).
- **Usage (minutes)** — `get_usage` (by `tenant_id`; `from` and `to` are **both required**). Returns `{tenantId, from, to, items:[{date, minutes, count}]}` — per-day conversation **count** and **minutes** (the conversational-minute unit). There is **no server default window** for usage — you must supply `from`/`to`.

### Time format for usage

`from`/`to` are ISO-8601 date-time with offset (`2026-06-01T00:00:00Z`). The REST API does **not** accept `7d`/`30d`/`from:…,to:…` shorthand — that's in-app sugar. Expand relative windows yourself first (`7d` ⇒ `from = now − 7d`, `to = now`; a date `from:…,to:…` ⇒ `…T00:00:00Z` / `…T23:59:59Z`). Both `from` and `to` are mandatory for `get_usage`.

## What the plugin will NOT do (payment changes are web-app only)

The plugin is strictly read-only for billing. It **cannot and will not**:
- buy, subscribe to, or change a plan;
- cancel or downgrade a subscription;
- open the Stripe billing portal or a checkout session;
- edit payment methods or move any money.

Those actions (the Stripe billing-portal and checkout flows, both **owner-only**) are deliberately excluded from the plugin. If a user wants to change plans, pay, update a card, or cancel, tell them to do it in the **web app** on the Billing page: select a plan card and confirm with **"Select this Plan"**, which takes them to **Stripe** to complete payment. Your role is to help them read their billing and **advise which plan fits** — never to charge them or change their subscription. (The Stripe webhook that updates subscription state is an internal server-to-server callback and is likewise never exposed.)

---

Reference source files (platform repo, for traceability): `backend/.../controller/AnalyticsRestController.kt`, `AnalyticsExportController.kt` (`:44` export, `:63/:69` date validation, `:96` 403 gate); `backend/.../controller/BillingRestController.kt` (`:52`–`:116`); `backend/.../component/NavigationTools.kt` (`:819` getBilling, `:895` getBillingContent, `:1063` getAnalytics, `:1198` fetchAnalyticsSummary, `:1295` parseAnalyticsInput); `backend/.../llm/constants/Prompts.kt` (`:505` ANALYTICS_PROMPT, `:531` BILLING_PROMPT); `backend/.../configuration/PromptConfiguration.kt` (`:387` billing model). Plugin conventions verified against `/Users/jirikastovsky/Developer/promethist/promethist-cowork-plugin/mcp-server/src/{client.ts,tool-result.ts,guides.ts,evaluation-tools.ts,integration-tools.ts,workspace-tools.ts,agent-tools.ts,index.ts}`.

**Conflicts/flags:** (1) The task prompt asks for "NPS" — confirmed it does not exist in the platform; mapped to `get_relational_analytics`/boolean evaluation insights and flagged in both spec and guide. (2) `export_analytics` returns binary; the shared `apiRequest` reads body as text and attempts `JSON.parse`, so only `format=json` is reliably inline-readable — flagged in spec and guide. (3) `get_extractor_analytics` is a POST returning 201 despite being a read — no `confirmGuard`, flagged in tool docs. (4) The repo keeps two guide copies (`mcp-server/guides/` and `skills/promethist/references/`); add the new `analytics.md`/`billing.md` to both if that mirror is maintained.
