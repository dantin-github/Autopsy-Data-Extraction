# Two-Party Modification (Police Proposal + Court Approval)

Modifications require **police proposal + court/ procuratorate approval**. Only after both agree can the police execute the update.

---

## Roles

| Role | Responsibility |
|------|----------------|
| Police | Propose modification, execute modification |
| Court / Procuratorate | Approve proposal |

---

## Table Structure

In Console:

```sql
create table t_modification_proposal(index_hash varchar, new_record_hash varchar, proposer varchar, approver varchar, status varchar, primary key(index_hash))
```

- `index_hash`: Case index (SHA256(case_id))
- `new_record_hash`: Proposed new record_hash
- `proposer`: Proposer identifier (e.g. police address or ID)
- `approver`: Approver identifier, empty until approved (use `-` to avoid parse errors)
- `status`: `PENDING` | `APPROVED` | `EXECUTED`

---

## Flow

```
Police propose ──> Court approve ──> Police execute
     (1)              (2)              (3)
```

### Step 1: Police propose modification

Police computes new `record_hash` and inserts into proposal table:

```
insert into t_modification_proposal (index_hash, new_record_hash, proposer, approver, status) values ("<index_hash>", "<new_record_hash>", "police", "-", "PENDING")
```

> Use `-` for approver when not yet approved (empty string may cause parse errors).

Also update the full record in private store so it matches `new_record_hash`.

### Step 2: Court approve

After court confirms, update approval info:

```
update t_modification_proposal set approver="court", status="APPROVED" where index_hash="<index_hash>"
```

### Step 3: Police execute

Only when `status=APPROVED`, police executes the update on the main table:

```
update t_case_hash set record_hash="<new_record_hash>" where index_hash="<index_hash>"
```

Then mark proposal as executed:

```
update t_modification_proposal set status="EXECUTED" where index_hash="<index_hash>"
```

---

## Full Example

See [MODIFICATION-EXAMPLE.md](MODIFICATION-EXAMPLE.md).

---

## Permission Control (Optional)

Configure in FISCO:

- Police: only `proposer` can insert, `approver` can update
- Court: only `approver` can update
- Execute: only police can update `t_case_hash`

---

## Constraints

1. Before execute: verify `approver` is non-empty and `status=APPROVED`
2. Only one `PENDING` or `APPROVED` proposal per `index_hash` at a time
3. Approval records and block history are auditable
