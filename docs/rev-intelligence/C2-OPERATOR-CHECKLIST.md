# C2 operator evidence checklist (Splendor)

Expected SHA everywhere: starts with `9a133438`. Nothing below writes,
freezes, migrates, or repairs — reads only. Do NOT run chat/stream/retry
POSTs (those are writes).

## A1. Node backend SHA + health

```bash
curl -s -o /tmp/ready.json -w "HTTP %{http_code}\n" \
  https://revluma-backend-vrsd.onrender.com/ready
python3 -c "import json;r=json.load(open('/tmp/ready.json'));print('status:',r['status']);print('node_build:',r['node_build']);print('python_build:',r['python_build']);print('python_ready:',r['python_ready'],'database_ready:',r['database_ready'])"
```

- Expect: HTTP 200, `status` = `ready`, `node_build` starts `9a133438`,
  `python_build` starts `9a133438`, both `*_ready` true.
- Mismatch = any SHA with a different prefix, any `*_ready` false,
  `status` ≠ ready, or non-200. Stop and report verbatim output.

## A2. Python service SHA (cross-check)

Get the public URL from Render dashboard → service
`srv-db9m923ncjis739s8co0` → Settings/Connect:

```bash
curl -s https://<python-public-url>/health | python3 -m json.tool | head -n 12
```

- Expect: HTTP 200, field `build` starts `9a133438`.
- If the Python service has no public URL, record "no public URL — covered by
  A1 `python_build`" instead. Do not expose it publicly for this check.

## A3. Read-only smoke tests (needs a merchant JWT)

Log into the merchant dashboard in your browser → devtools → copy the
`access_token` (short-lived session token; fine to use, do not post secret
keys anywhere):

```bash
export TOKEN="<paste access_token>"
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://revluma-backend-vrsd.onrender.com/api/v1/rev/conversations?limit=1" \
  | head -c 600; echo
# expect: HTTP 200, "success":true, a conversations list
export CONV="<one conversation id from above>"
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://revluma-backend-vrsd.onrender.com/api/v1/rev/conversation/$CONV?limit=5" \
  | python3 -c "import json,sys;r=json.load(sys.stdin);print('success:',r['success']);print('seqs:',[(m['sequence_number'],m['role']) for m in r['data']['messages']])"
# expect: success True, messages listed ascending (restoration read path OK)
```

## B. Supabase recovery evidence

Project: Revluma-Database (`jblpgqmbgdlzitprudgt`), region eu-west-1.

1. **Plan:** Dashboard → project → Settings → General (plan banner) —
   record the exact plan name. PITR needs Pro or above; Free = flag it.
2. **PITR status:** Database → Backups (or Settings → Database → Backups)
   → Point-in-time recovery — record ON/OFF + retention days.
3. **Latest recoverable timestamp:** same panel — record the earliest
   restorable point shown and the time you read it.
4. **Latest backup:** same page → most recent scheduled backup — record its
   completed timestamp + status.

Acceptable: verbatim values pasted into §C. Screenshots optional backup.
Not acceptable: "looks fine" without values.

## C. Results template (fill in and return)

```text
A1: HTTP=___ status=___ node_build=___ python_build=___ python_ready=___ database_ready=___
A2: HTTP=___ build=___  (or: no public URL, covered by A1)
A3: conversations_list_HTTP=___ success=___ / conversation_read_success=___ seqs=___
B1 plan=___  B2 PITR=___ retention=___  B3 earliest_recoverable=___ (read at ___Z)
B4 latest_backup=___ status=___
```

Return this block as-is with values filled. On ANY mismatch vs A1/A2
expectations, stop and paste the full command output instead.
