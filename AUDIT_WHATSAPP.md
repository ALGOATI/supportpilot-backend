# WhatsApp Integration Audit — SupportPilot

**Date:** 2026-04-16
**Scope:** Multi-tenancy, learning pipeline, knowledge base integration
**Status:** Audit only, no changes made

---

## 1. Message Flow Diagram

```
INBOUND WhatsApp message from Meta
        |
        v
POST /webhooks/whatsapp  (routes/integrations.js:238)
        |
        ├── HMAC-SHA256 signature verification (if WHATSAPP_APP_SECRET set)
        |
        v
whatsappAdapter.handleInboundWebhook()  (messaging/channels/whatsapp.js:258)
        |
        ├── parseInboundMessages() — extracts {from, text, metaMessageId, phoneNumberId}
        |
        v
  ┌─ Is sender the business owner?
  │   resolveBusinessOwnerByPhone(from)  (services/whatsappService.js:77)
  │   Scans ALL business_profiles rows for matching phone
  │
  ├── YES (owner) ──> processBusinessOwnerWhatsAppReply()
  │                    ├── Find latest paused WhatsApp conversation for this owner
  │                    ├── Send reply to customer via Meta API
  │                    ├── Store as human_reply in messages table
  │                    └── Update conversation to human_mode
  │
  └── NO (customer) ──> Resolve which tenant owns this message
                         |
                         ├── 1st: findClientByPhoneNumberId(phoneNumberId)
                         │   Looks up client_settings WHERE whatsapp_phone_number_id = X
                         │
                         ├── 2nd (fallback): resolveWhatsAppClientId(from)
                         │   Looks up conversation_map for prior mapping
                         │   Falls back to env var WHATSAPP_DEFAULT_CLIENT_ID
                         │
                         v
                    Deduplicate via whatsapp_inbound_events table
                         |
                         v
                    isBusinessActive() check (plan gating)
                         |
                         v
                    engine.handleIncomingMessage()  (messaging/core/conversationEngine.js:692)
                         |
                         ├── Get/create conversation via conversation_map
                         ├── Check if escalated/paused → forward to owner, no AI reply
                         ├── tryDirectKnowledgeAnswer() — keyword-match against KB
                         │   (knowledgeAnsweringService.js:737)
                         ├── buildAiReply() — full LLM call via OpenRouter
                         │   ├── loadStructuredBusinessKnowledge(userId)
                         │   ├── loadKnowledgeBaseForPrompt(userId, {userMessage})
                         │   └── System prompt includes business info + KB context
                         ├── evaluateResponseSafety() — escalation detection
                         └── Return {reply, escalated, extractedData}
                         |
                         v
                    If reply exists:
                         ├── sendWhatsAppTextMessage(to: from, text: reply)
                         │   Uses per-client config from client_settings
                         │   Falls back to env WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID
                         └── incrementMonthlyUsage()
```

---

## 2. Multi-Tenancy Status: PARTIAL

### What works
- **Per-tenant WhatsApp credentials exist in the database.** The `client_settings` table has columns: `whatsapp_phone_number_id`, `whatsapp_waba_id`, `whatsapp_access_token`, `whatsapp_connected` (added in `sql/2026-03-26-whatsapp-multi-client.sql`).
- **Webhook routing by phone_number_id works.** `findClientByPhoneNumberId()` looks up the `client_settings` row matching the `phone_number_id` from the Meta webhook payload metadata.
- **Unique index prevents two tenants from connecting the same phone number.**
- **Connect/disconnect API endpoints exist** at `/api/integrations/whatsapp/connect` and `/disconnect`.
- **Sending uses per-client credentials.** `sendWhatsAppTextMessage()` checks `clientConfig` first, falls back to env vars.

### What's broken or risky

1. **Single Meta webhook endpoint shared across all tenants.** The `WHATSAPP_VERIFY_TOKEN` is a single global env var. All tenants must configure their Meta app to point to the same webhook URL with the same verify token. This means either:
   - All tenants share one Meta App (which means one app secret, one set of permissions) — feasible but restrictive.
   - OR each tenant has their own Meta App, which requires them all to share the same verify token — fragile and unusual.
   - **There is no per-tenant webhook routing by WABA ID or app ID** — only by `phone_number_id`.

2. **Fallback to env var credentials is a cross-tenant leak risk.** If `findClientByPhoneNumberId()` returns null (e.g., a new tenant hasn't saved their credentials yet), the code falls through to `resolveWhatsAppClientId()` which ultimately falls back to `WHATSAPP_DEFAULT_CLIENT_ID`. This means an unrecognized phone_number_id routes to the default tenant — messages could be attributed to the wrong business.

3. **Owner phone detection scans ALL tenants.** `resolveBusinessOwnerByPhone()` (whatsappService.js:77) fetches up to 5000 `business_profiles` rows, normalizes every phone number, and checks for matches. If two tenants have owners with the same phone number, it returns `ambiguous` and skips owner mode. This is O(n) on total tenant count and will degrade.

4. **Hardcoded env var credentials in .env.** The `.env` file contains:
   - `WHATSAPP_TOKEN` — a real permanent access token
   - `WHATSAPP_PHONE_NUMBER_ID` — `991995960667256`
   - `WHATSAPP_BUSINESS_ACCOUNT_ID` — `954939513540869`
   - `WHATSAPP_DEFAULT_CLIENT_ID` — a specific user UUID

   These serve as the "default tenant" fallback. In production multi-tenancy, a second tenant who connects their own number should work. But any tenant whose `phone_number_id` is NOT stored in `client_settings` will fall back to these env vars, sending replies from the wrong WhatsApp number.

5. **No signature verification per-tenant.** `WHATSAPP_APP_SECRET` is a single env var. If tenants have separate Meta apps, only one app's signatures can be verified.

### Schema (per-tenant WhatsApp columns in `client_settings`)

| Column | Type | Notes |
|--------|------|-------|
| `whatsapp_phone_number_id` | text | Meta Phone Number ID |
| `whatsapp_waba_id` | text | WhatsApp Business Account ID |
| `whatsapp_access_token` | text | Permanent token (never sent to frontend) |
| `whatsapp_connected` | boolean | DEFAULT false |

Indexed: unique on `whatsapp_phone_number_id` WHERE connected = true.

---

## 3. Learning Pipeline Status: BROKEN for WhatsApp

### How the widget learning pipeline works (reference)

1. AI has low confidence or can't answer → `evaluateResponseSafety()` triggers escalation
2. Conversation status set to `escalated`
3. `createEscalationNotification()` inserts into `notifications` table + sends email via Resend
4. Business owner opens dashboard, sees escalated conversation
5. Owner types a reply via `POST /api/conversation/reply`
6. **That endpoint calls `learnFromHumanReply()`** (conversations.js:616) which:
   - Finds the latest customer question in the conversation
   - Inserts a `knowledge_base` row with `source: "human_reply"`
7. Future questions match against this KB entry

### Where WhatsApp diverges

**Escalation trigger: WORKS.** The same `evaluateResponseSafety()` runs for WhatsApp messages. Low confidence triggers escalation. The `ESCALATION_REPLY_MESSAGE` is sent back to the customer.

**Owner notification: PARTIAL.**
- Dashboard `notifications` table insert: WORKS (same `createEscalationNotification()`)
- Email notification via Resend: WORKS (if `RESEND_API_KEY` configured)
- WhatsApp notification to owner: WORKS ONLY if conversation is already in paused/escalated state AND a new customer message arrives. The `maybeForwardPausedInboundToOwner()` function sends the customer's message to the owner's WhatsApp. But the **initial escalation** does NOT trigger a WhatsApp message to the owner — it only sets the status to `escalated` and creates a notification/email.

**Owner reply via WhatsApp: DOES NOT LEARN.**
When the business owner replies via WhatsApp (detected by `resolveBusinessOwnerByPhone()`), the `processBusinessOwnerWhatsAppReply()` function:
- Sends the reply to the customer ✓
- Stores the reply as `human_reply` in messages ✓
- Updates conversation to `human_mode` ✓
- **Does NOT call `learnFromHumanReply()`** ✗

This is the critical gap. The `learnFromHumanReply()` function is only called in the dashboard reply endpoint (`POST /api/conversation/reply`, conversations.js:616). The WhatsApp owner reply path in `processBusinessOwnerWhatsAppReply()` (whatsapp.js:122 and whatsappService.js:305) never calls it.

**Owner reply via dashboard for WhatsApp conversations: LEARNS.**
If the owner uses the dashboard to reply to an escalated WhatsApp conversation, `learnFromHumanReply()` IS called, and the reply IS sent via WhatsApp to the customer. This path works end-to-end.

### Summary

| Step | Widget | WhatsApp |
|------|--------|----------|
| AI escalates low-confidence | Yes | Yes |
| Notification in dashboard | Yes | Yes |
| Email to owner | Yes | Yes |
| WhatsApp message to owner | N/A | Only on subsequent customer messages |
| Owner replies via dashboard | Learns + sends | Learns + sends via WA |
| Owner replies via WhatsApp | N/A | Sends but DOES NOT learn |

---

## 4. Knowledge Base Integration Status: WORKS

### Is the knowledge base queried for WhatsApp messages?

**Yes.** The WhatsApp adapter calls `engine.handleIncomingMessage()` which runs the same pipeline as all channels:

1. **Direct knowledge lookup** (`tryDirectKnowledgeAnswer`): keyword-matched against business hours, profile, menu, FAQs, booking rules, and `knowledge_base` table. If a match is found, the reply is returned without an LLM call.

2. **LLM-assisted reply** (`buildAiReply`): the system prompt includes:
   - `loadStructuredBusinessKnowledge(userId)` — business profile, hours, menu, FAQs, booking rules
   - `loadKnowledgeBaseForPrompt(userId, {userMessage})` — ranked `knowledge_base` entries relevant to the user's message

Both paths are identical for WhatsApp and the website widget. The `userId` passed is the resolved tenant's ID, so the correct tenant's knowledge base is used.

### Any places WhatsApp bypasses the knowledge base?

**No.** The only code path that bypasses the knowledge base is the public `/api/chat` endpoint (conversations.js:813), which uses a separate `openAiSupportService.generateReply()` pipeline. WhatsApp does NOT use this endpoint.

---

## 5. Files Involved in WhatsApp Flow

| File | Role |
|------|------|
| `routes/integrations.js` | Webhook endpoints, connect/disconnect/status APIs |
| `messaging/channels/whatsapp.js` | WhatsApp adapter: parse, route, send, owner reply handling |
| `messaging/core/conversationEngine.js` | Core AI pipeline (shared with all channels) |
| `messaging/index.js` | Wires adapter + engine + store together |
| `messaging/persistence/conversationStore.js` | Thin pass-through to service deps |
| `services/whatsappService.js` | Client config lookup, phone resolution, dedup, owner detection |
| `services/conversationPipelineService.js` | Alternative pipeline (used by job worker + dashboard) |
| `services/knowledgeAnsweringService.js` | Knowledge base querying + `learnFromHumanReply()` |
| `services/escalationService.js` | Escalation notifications (DB + email) |
| `services/planService.js` | Plan limits, business active check |
| `services/aiService.js` | LLM prompt construction, extraction, safety evaluation |
| `server.js` | Dependency wiring |
| `sql/2026-03-26-whatsapp-multi-client.sql` | Schema for per-client WA credentials |
| `sql/2026-03-09-whatsapp-inbound-dedupe.sql` | Dedup table |
| `sql/2026-03-11-owner-whatsapp-takeover.sql` | Owner takeover schema |

---

## 6. Top 5 Concrete Problems (by severity)

### P1: Owner WhatsApp replies do not trigger learning

**Severity: Critical (breaks core product promise)**

`processBusinessOwnerWhatsAppReply()` in both `whatsapp.js` and `whatsappService.js` stores the human reply and sends it to the customer, but never calls `learnFromHumanReply()`. This means the learning loop — the product's key differentiator — is completely broken for the most natural owner reply path on WhatsApp.

### P2: Env var fallback creates cross-tenant message routing risk

**Severity: High (data leak between tenants)**

If a customer messages from a phone_number_id not registered in `client_settings`, the system falls through to `WHATSAPP_DEFAULT_CLIENT_ID`. The customer's message gets attributed to the wrong tenant, and the AI reply uses the wrong tenant's knowledge base and business profile. The reply is also sent from the default tenant's WhatsApp number.

### P3: Hardcoded WhatsApp credentials in .env

**Severity: High (security + multi-tenancy barrier)**

`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and `WHATSAPP_DEFAULT_CLIENT_ID` are hardcoded in `.env`. These serve as the implicit "first tenant" and are used as fallback for any unresolved messages. In a multi-tenant system, there should be no default — unresolvable messages should be logged and dropped, not routed to a specific tenant.

### P4: Owner phone resolution is O(n) over all tenants

**Severity: Medium (performance + correctness at scale)**

`resolveBusinessOwnerByPhone()` fetches up to 5000 rows from `business_profiles` and scans them all in JavaScript. With many tenants, this becomes slow. Worse, if two owners have the same phone number, the system silently drops into `ambiguous` mode and ignores the owner reply entirely, with no feedback to the owner.

### P5: No WhatsApp notification to owner on initial escalation

**Severity: Medium (UX gap for WhatsApp-primary users)**

When a conversation first escalates, the owner gets a dashboard notification and an email. They do NOT get a WhatsApp message. The `maybeForwardPausedInboundToOwner()` function only fires when a new customer message arrives on an already-paused conversation, not on the initial escalation event. Business owners who primarily monitor via WhatsApp may miss escalations.

---

## 7. Recommended Fix Order

### 1st: Add `learnFromHumanReply()` to WhatsApp owner reply path (P1)

**Why first:** This is the core product promise. Without it, the learning loop is dead for WhatsApp. The fix is small — add a `learnFromHumanReply()` call in both `processBusinessOwnerWhatsAppReply()` implementations (whatsapp.js and whatsappService.js) and in the WhatsApp adapter's owner reply flow.

### 2nd: Remove or gate the env var fallback (P2 + P3)

**Why second:** Cross-tenant data leakage is a trust-breaking bug. Change `resolveWhatsAppClientId()` to throw/drop if no `client_settings` match exists instead of falling back to `WHATSAPP_DEFAULT_CLIENT_ID`. Log unresolvable messages for debugging but do not route them to a default tenant.

### 3rd: Send WhatsApp notification on initial escalation (P5)

**Why third:** Completes the escalation UX loop. When `createEscalationNotification()` fires, also send a WhatsApp message to the owner if they have a `business_owner_phone` configured and the conversation channel is WhatsApp.

### 4th: Optimize owner phone resolution (P4)

**Why fourth:** Not urgent at current scale but will break with growth. Replace the full-table scan with a database-side query: `SELECT user_id FROM business_profiles WHERE normalized_phone = $1`. Requires adding a `normalized_phone` column or using a DB function.

### 5th (optional): Audit shared-app-secret model

Not blocking but worth planning: decide whether multi-tenant means one shared Meta App or per-tenant apps, and adjust webhook verification accordingly.
