# C2 pre-freeze manifest (baseline checksums, NO message content)

Captured: 2026-11-26 ~23:15Z via read-only Supabase queries. This is the
PRE-FREEZE baseline (writers active; low traffic). The authoritative manifest
is re-captured post-freeze with the identical queries; any drift is
reconciled before repair. UUIDs + checksums only — safe to keep in git.

## M1 — global (conversation_messages)

- n = 776
- id_seq_md5 = 752493ad452edf110b24ea7b6c3e1fe5
  (`md5(string_agg(id || sequence_number, ',' ORDER BY id))`)
- full_row_md5 = 1d6744617eb81311fde96faeecfe4e38
  (id, sequence_number, role, created_at, content)

## M2 — affected conversations (57 rows: id, n, min_seq, max_seq, md5(id→seq))

```csv
02b19919-1742-4cf0-9ff8-93a6fd29356a,4,1,2,1e96ca4cbf40821e20d7c2b240707a3c
02c52144-4884-46a3-bdcc-dbfc13ff3be0,24,1,21,99f78b3980ee7c1364d4b34547e1577e
0b28348c-d24c-4484-8eb6-c5402b0683b3,3,1,2,a85a7c4e6354e5880f0bbda09cb60901
0eb903ae-f26c-458b-aa77-e7d545c4592e,6,1,5,4e9f7919b146a91b1dda6cdd480f2a53
117d2d35-f954-472c-b618-edc4e7dca510,3,1,2,6f1dd0679f7e2779bb7ce2fe7fe4ca0a
38229355-a03f-4e1e-b806-5cdbdfb2fb13,4,1,3,6d072d43ad38714883ec8c4ebb987446
39b12c47-5116-4362-b3b0-919dabd40e3d,8,1,7,cdcb6b4e9f9b08329c96b07ee2f6ff2a
41bdd577-7626-4019-9e9b-4b7a03550155,4,1,2,36d546f93d5b92093bd3d8dd6a06c1f9
520196a7-abea-4a32-8768-905f85d56297,4,1,2,d78731a117868d64a0156b1995dbe222
558a5bb3-f47a-4ae0-93c6-a15976e3d0b9,4,1,2,5bc090616cd208d44d3de23871873cd8
58b20615-c82f-4180-9856-cf3223d718ba,4,1,2,a601773a9e9ab0fd9296d5d4042c0c0f
5ddf7c11-1ab9-4026-ba2a-7841538589cf,4,1,2,c2c9f8387060356f4f7fabdea46090ec
5f886bcc-49e6-4833-acf3-264f6c4d012e,8,1,6,70800abf51ab66245fe93040691d1ab2
62483ac0-8cdd-4877-9eb5-7a335496bedb,4,1,2,8ab022008b25fb8fe519bd3d43b9879b
6fa818ba-4d76-4e63-9900-e23eb3bc95fc,8,1,6,f0dacb558b18e782c94cc3445ebad373
71e6229a-559a-44c6-b596-ec32d4b71c7c,3,1,2,59aabe1465a2a4cd1288240448b54766
77263d4d-44b7-45cf-86e5-0b19dc38b9ee,4,1,2,a6860d21106ab6c7da2551561b318a0d
7777e9e9-af15-41b3-9b72-d964d05b7bc7,4,1,2,7bb8da3d361a19cbf5fe447b4c45bcb2
7937a215-2dc2-4769-bcbc-3fc95d0ed6cc,36,1,31,8365dc94aa21550ebe93566358ba1b54
7947d328-c7ee-44d3-bb7b-81179d07fbd7,12,1,10,9487e9e84240f03be1bdde701f9b7bca
7aea5999-44eb-4c18-a0b7-6ca06a77d5df,12,1,10,32af9519253be2a636f2e97615596fa3
7c0f8b34-7b4e-41ff-9d88-cb13717e51c6,4,1,2,77565af0f3f3bed6037af67d472f7367
7c68550b-53c9-4249-bbb6-c6987eaa2b47,4,1,3,37b0ccae59194235977ea0d475cda404
7e3d589c-d6b2-4b5b-be0a-29ab6e085bca,4,1,3,10c18119a57cd471faaac317552a75cc
81451cb7-bfa6-4c5c-a942-84691a0b1a8f,8,1,6,b34e887648a19f5d661ec2361f79b359
86f2b28f-26e2-4d86-8db1-d98831e509ff,4,1,2,b5d78270ee44f4e6134974ddc26d799e
8e8e1c00-5096-4a3b-a4df-a2f5993e44e5,4,1,2,3e7654bae7000f588bbef8ad8a31d491
9059fd38-a44b-4bca-9b1e-615870464c08,4,1,3,e2bf4c2b1c50d4e11b8efd1d60c2782f
941e2169-fa78-43fd-b616-5c394251d727,12,1,10,e0553a8e12c88288058cca00c853ff68
9446fc22-0efd-4661-a8df-270d4e0e74c7,4,1,3,8e19d415b8459601e8c9a9381e3ee6f6
a2616773-1faf-4140-8e90-ad398ab1b0ff,4,1,2,245d6368195b58977388e898a90e2529
a64db8e5-0629-4bb9-9eea-36dab69f8f89,12,1,9,ad2f85aa045d8a2b32e53a5ef45c742d
a8d96cec-f577-48b9-b878-db3132880028,4,1,2,5e215137d29abc4a6ea5fcc2807e07be
ab21056b-6aea-444e-80eb-21f903858783,4,1,2,b6b2c00fac9060150cff4d8cc29077d8
b5b927b5-28c8-4dde-9a26-e41784a20d08,4,1,2,1600c2c638c8ee7c715bbdf662ebd540
b7082c1b-3b5a-4944-b767-e4aade0e5c7f,4,1,3,1bcb1297c18e19a1c971cf9db7348b80
b8d28dfa-b363-48fa-ac23-3e987f854665,4,1,2,f70a2cdcbbd91444b07a327dd2e3827e
bc569dd9-6189-49ae-a11c-4cee6b435530,4,1,2,b993dc35596a498fdf1610e6755d2422
bd86480f-1cee-4374-b7a0-b21d6ecc2203,8,1,6,c843a30e30452136a1ce4025d84304d8
c1c9f7f2-95fa-43d8-b411-9888c6ef5a0b,20,1,18,3e78262b2590175f0e406bf74424fde5
c7c4d82e-d87c-4123-8c3f-fc09689eb37f,4,1,2,b8f882f4fe7a0f2853b70d35599d4eb2
cb956d29-f800-47f0-91a8-f1b36ac90ebd,8,1,6,25a4f892b31e955844c605062564e6ed
cbf230e2-27b0-45f4-9c77-16094b53ed97,12,1,10,8ad3d0d4afbdbaf5f47b59cd180bf761
d481efbd-1835-46df-b98e-1db4d6ee5309,36,1,32,7d5fce2e02f397a7c25b91f2edfe59b2
dbd249c1-714b-4932-9abf-9c1484ba4b70,4,1,2,6bf0eb6ff457c1b056d6f30c6d2d8004
dd199e4c-13c1-40cf-b3b1-181910442234,4,1,2,dc1faf332e9b3f28fc86e4b71a5df65e
e3b400bf-58dd-44b0-aa3e-92fe698b6905,12,1,10,809e38dca76c31be8dc2ad61c9d3d437
e3b47d49-7d2c-41b1-9cba-7323cc3384fe,4,1,2,386a8adb002cb93a23e87d1d866abd64
e477ab80-46b5-42b1-a52d-667a64bf6ed8,4,1,2,d9500b32da83fcd68732e31388de403f
eb8aae6c-0269-457b-956c-3603a50cf933,8,1,6,d4c61c63de9fc6184c7ab312c2d0348c
ee6a3b00-91cc-437f-b6c2-5c81888d7637,3,1,2,0bcfb4d42a1296b20293ef5c9cbde6a0
f60e2a4c-7e5b-4ac7-b229-f69285dea0a0,12,1,10,8462335213dcb1060ee6d056e1582a70
fc5be04b-4f9b-44c7-ab1e-66ea5f83c818,4,1,2,6ee83595ad083a0f7b75fefa171bfab4
fe6413ad-f7de-4fba-af9d-fbf97a69a791,16,1,13,c46640e1c5bf1c2040f42c41ae24e5b1
ff9b5505-6136-439d-9d2e-e2a3bbc32cbd,4,1,2,e295ac6390319aa2b84dc7fa5b4d1788
ffd17d6e-a8b0-4aeb-a648-0a2aeecebc38,8,1,6,7580c9399938f2c34f62c89ded7d98bc
ffe7e34f-fdcb-4a80-b13d-e5b4b765b768,4,1,3,db4d7cd39c30a6aec2c30be456529574
```

## M3 — untied rows (convos with zero tied groups)

- untied_rows = 350
- untied_id_seq_md5 = c656d81e80b60efa89a430c4d11f8604
  (must be IDENTICAL post-repair: untied rows are never touched)

## M4 — tie summary

- tied_groups = 109, ambiguous_groups = 0, excess_rows = 109

## M5 — non-sequence columns, all rows (repair must preserve)

- noseq_md5_all_rows = b3036eb24f5306fb3eedfce9416d1aa8
  (id, conversation_id, role, created_at, organization_id, user_id, content,
  correlation_id, agent_name, metadata, has_error — every audited column
  EXCEPT sequence_number; must be IDENTICAL post-repair)

## Reconciliation rules (post-repair)

1. M1.n still 776; per-convo counts in M2 unchanged (n column).
2. M3.untied_id_seq_md5 identical (untied rows untouched).
3. M5.noseq_md5_all_rows identical (only sequence_number changed).
4. M4 tied_groups = 0; ambiguous still 0.
5. M2 md5s for affected convos change ONLY via their excess rows' numbers
   (placement re-derivable: excess above pre-repair max in
   (sequence_number, created_at, id) order; keepers keep numbers).
## Verification record (this file vs live prod, ~23:20Z)

- M2: 57 rows, sorted by id, 0 dup ids, 0 malformed.
- counts_max_fp (id:n:max) file == db == b80f56462abdddc0827d467d994c64ba
- min_fp (id:min) file == db == 92ff36ecc9fbd330a6bc4b68c95bc351
- md5_of_md5s (all 57 per-convo md5s) file == db
  == df1bf6465d0b03e52cfd89f5d38485f2
- Two transcription errors found and corrected via targeted single-row
  re-queries (41bdd577, cbf230e2); duplicate partial block removed.
- M2 table is VERIFIED COMPLETE AND CORRECT as of capture time.

## M6 — repair-plan fingerprints (keeper rule: earliest (created_at, id) wins)

- affected_convos = 57
- keeper_untied_rows = 667
  (776 total − 109 excess; keepers + untied rows keep their numbers)
- keeper_untied_fp = 58a740ae8ed900c7f7d48da26e57d7de
  (`md5(string_agg(id || sequence_number, ',' ORDER BY id))` over the 667
  rows that MUST keep their exact (id, sequence_number) pairing post-repair)
- excess_rows = 109
- excess_idset_fp = fed008659476c87e469619b4b42509e5
  (`md5(string_agg(id, ',' ORDER BY id))` over the 109 excess rows)
- full_plan_fp = eab1133856a6575df8bcc6a5483ea50f
  (conversation_id, sequence_number, id, rank over excess rows ordered by
  (conversation_id, sequence_number, rank) — binds the full keeper/excess
  assignment, not just the id set)

## M7 — authoritative-manifest protocol (maintenance window)

1. After writer freeze is proven, re-run the M1–M6 queries verbatim.
2. If all M1–M6 values match this file: no drift; this manifest is promoted
   to authoritative.
3. If any value differs: drift occurred between baseline and freeze (should
   be impossible post-freeze — investigate; do NOT repair until the
   post-freeze manifest is self-consistent and a fresh M6 plan is derived
   from it).
4. Post-repair reconciliation gates:
   - keeper_untied_fp IDENTICAL (667 rows untouched in (id, seq) pairing);
   - M5 noseq_md5 IDENTICAL (no non-sequence column changed on any row);
   - M4 tied_groups = 0, ambiguous = 0;
   - excess rows occupy max+1.. in (sequence_number, created_at, id) order
     within each conversation (re-derivable from M2 + full_plan_fp).
