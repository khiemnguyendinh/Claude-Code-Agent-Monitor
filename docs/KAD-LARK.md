# KAD Lark 2-way adapter

Phase 6.6 adds Lark as an adapter over the existing KAD task API. It does not
run Claude freely from a group chat.

## Environment

- `KAD_LARK_ADAPTER_TOKEN`: static token used by the long-connection worker when
  it posts normalized events to `/api/kad/lark/*`.
- `KAD_LARK_OWNER_OPEN_ID`: only this Lark `open_id` can create tasks, reply,
  lock briefs, or decide reports.
- `KAD_LARK_APP_ID` / `KAD_LARK_APP_SECRET`: optional outbound card delivery via
  Lark Open Platform. If omitted, KAD still records DB state and skips delivery.
- `KAD_LARK_GROUP_CHAT_ID`: optional group chat that receives final report cards.
- `KAD_LARK_VERIFICATION_TOKEN`: optional token for URL-verification/callback
  testing. Long connection does not require a public URL.

## Ingress

- `POST /api/kad/lark/messages`: normalized message payload
  `{ open_id, chat_id, chat_type, text, message_id }`.
- `POST /api/kad/lark/events`: Lark event payload. Also responds to
  `type=url_verification`.
- `POST /api/kad/lark/card-action`: Lark interactive card action callback.

Non-owner actors are read-only. Their write/action attempts return `403` and
write `audit_log` with `channel='lark'` plus `details.actor_ref`.

## Long Connection

Official Lark long connection support uses `@larksuiteoapi/node-sdk` `WSClient`
with `EventDispatcher` for `im.message.receive_v1`. That SDK is not added in
this phase because dependency changes require owner approval. The adapter routes
above are the stable business boundary for a long-connection worker.

Once the SDK is approved/installed:

```bash
KAD_API_BASE=http://127.0.0.1:4820 \
KAD_LARK_ADAPTER_TOKEN=... \
KAD_LARK_APP_ID=... \
KAD_LARK_APP_SECRET=... \
node scripts/kad-lark-long-connection.mjs
```

Lark official docs note that long connection supports event subscriptions, not
callback subscriptions. If card-action callbacks are not delivered through the
installed SDK/channel layer, expose `/api/kad/lark/card-action` through an
approved callback transport.
