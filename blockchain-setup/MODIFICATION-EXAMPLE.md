# Example: Full Modification Flow for Existing Chain Data

Using case `TEST-2025-001`: change examiner from `police` to `police_unit_A`. Requires **police proposal + court approval + police execution**.

---

## Prerequisites

- Record already on chain (see [HASH-ONLY-EXAMPLE.md](HASH-ONLY-EXAMPLE.md) for write)
- `t_modification_proposal` table created

---

## Data Summary

| Item | Old | New |
|------|-----|-----|
| case_id | TEST-2025-001 | TEST-2025-001 |
| examiner | police | police_unit_A |
| index_hash | 2d0ea1b5e46dad2f6014050883c314db8ac243609ed64ac75beb5850978750ae | (unchanged) |
| record_hash | 22921f46a2311a643303665896f08685d26d7cbf218ae56ff2e4b4ea1d834ab0 | a317482a9a4dd8111078f17d3a18f6fb152c9ad1bd5dd3aa02ff50b0fd2a0154 |

---

## Step 0: Create Proposal Table (first time only)

In **Console**:

```
create table t_modification_proposal(index_hash varchar, new_record_hash varchar, proposer varchar, approver varchar, status varchar, primary key(index_hash))
```

---

## Step 1: Police Propose Modification

Police updates the full record in private store, computes new `record_hash`, then inserts the proposal on chain.

**1.1 Update private store** (edit `~/.case_record_store.json` or via program)

**1.2 Insert proposal in Console:**

> Note: Use `-` for approver when not yet approved to avoid empty-string parse errors.

```
insert into t_modification_proposal (index_hash, new_record_hash, proposer, approver, status) values ("2d0ea1b5e46dad2f6014050883c314db8ac243609ed64ac75beb5850978750ae", "a317482a9a4dd8111078f17d3a18f6fb152c9ad1bd5dd3aa02ff50b0fd2a0154", "police", "-", "PENDING")
```

**1.3 Query proposal status:**

```
select * from t_modification_proposal where index_hash = "2d0ea1b5e46dad2f6014050883c314db8ac243609ed64ac75beb5850978750ae"
```

Expect `status=PENDING`, `approver=-`.

---

## Step 2: Court Approve

After court confirms, update approval:

```
update t_modification_proposal set approver="court", status="APPROVED" where index_hash="2d0ea1b5e46dad2f6014050883c314db8ac243609ed64ac75beb5850978750ae"
```

Query again:

```
select * from t_modification_proposal where index_hash = "2d0ea1b5e46dad2f6014050883c314db8ac243609ed64ac75beb5850978750ae"
```

Expect `status=APPROVED`, `approver=court`.

---

## Step 3: Police Execute

Only when `status=APPROVED`, police executes the update.

**3.1 Update t_case_hash:**

```
update t_case_hash set record_hash="a317482a9a4dd8111078f17d3a18f6fb152c9ad1bd5dd3aa02ff50b0fd2a0154" where index_hash="2d0ea1b5e46dad2f6014050883c314db8ac243609ed64ac75beb5850978750ae"
```

**3.2 Mark proposal as executed:**

```
update t_modification_proposal set status="EXECUTED" where index_hash="2d0ea1b5e46dad2f6014050883c314db8ac243609ed64ac75beb5850978750ae"
```

---

## Step 4: Verify

**Query t_case_hash** (record_hash updated):

```
select * from t_case_hash where index_hash = "2d0ea1b5e46dad2f6014050883c314db8ac243609ed64ac75beb5850978750ae"
```

Expect `record_hash=a317482a9a4dd8111078f17d3a18f6fb152c9ad1bd5dd3aa02ff50b0fd2a0154`.

**Query proposal table** (flow complete):

```
select * from t_modification_proposal where index_hash = "2d0ea1b5e46dad2f6014050883c314db8ac243609ed64ac75beb5850978750ae"
```

Expect `status=EXECUTED`.

---

## Full Command Summary (copy-paste)

**Console - Step 0 (first time):**
```
create table t_modification_proposal(index_hash varchar, new_record_hash varchar, proposer varchar, approver varchar, status varchar, primary key(index_hash))
```

**Console - Step 1 (police propose; use - for approver when not approved):**
```
insert into t_modification_proposal (index_hash, new_record_hash, proposer, approver, status) values ("2d0ea1b5e46dad2f6014050883c314db8ac243609ed64ac75beb5850978750ae", "a317482a9a4dd8111078f17d3a18f6fb152c9ad1bd5dd3aa02ff50b0fd2a0154", "police", "-", "PENDING")
```

**Console - Step 2 (court approve):**
```
update t_modification_proposal set approver="court", status="APPROVED" where index_hash="2d0ea1b5e46dad2f6014050883c314db8ac243609ed64ac75beb5850978750ae"
```

**Console - Step 3 (police execute):**
```
update t_case_hash set record_hash="a317482a9a4dd8111078f17d3a18f6fb152c9ad1bd5dd3aa02ff50b0fd2a0154" where index_hash="2d0ea1b5e46dad2f6014050883c314db8ac243609ed64ac75beb5850978750ae"
update t_modification_proposal set status="EXECUTED" where index_hash="2d0ea1b5e46dad2f6014050883c314db8ac243609ed64ac75beb5850978750ae"
```

---

## Flow Diagram

```
t_case_hash (old)          t_modification_proposal              t_case_hash (new)
record_hash=22921...  -->  insert PENDING                   
                          update APPROVED (court)  -->  update record_hash=a31748...
                          update EXECUTED
```
