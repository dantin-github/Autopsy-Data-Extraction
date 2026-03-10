package org.dissertation.blockchain;

/**
 * Two-party modification: police proposes, court approves, police executes.
 * Chain tables: t_case_hash, t_modification_proposal.
 */
public class ModificationApprovalService {

    /**
     * Step 1 - Police proposes modification.
     * Returns console insert for t_modification_proposal.
     */
    public String getProposeCommand(String indexHash, String newRecordHash, String proposerId) {
        return String.format(
            "insert into t_modification_proposal (index_hash, new_record_hash, proposer, approver, status) values (\"%s\", \"%s\", \"%s\", \"-\", \"PENDING\")",
            indexHash, newRecordHash, proposerId
        );
    }

    /**
     * Step 2 - Court approves.
     * Returns console update for t_modification_proposal.
     */
    public String getApproveCommand(String indexHash, String approverId) {
        return String.format(
            "update t_modification_proposal set approver=\"%s\", status=\"APPROVED\" where index_hash=\"%s\"",
            approverId, indexHash
        );
    }

    /**
     * Step 3 - Police executes (only when status=APPROVED).
     * Returns console update for t_case_hash.
     */
    public String getExecuteCommand(String indexHash, String newRecordHash) {
        return String.format(
            "update t_case_hash set record_hash=\"%s\" where index_hash=\"%s\"",
            newRecordHash, indexHash
        );
    }

    /**
     * Mark proposal as executed.
     */
    public String getMarkExecutedCommand(String indexHash) {
        return String.format(
            "update t_modification_proposal set status=\"EXECUTED\" where index_hash=\"%s\"",
            indexHash
        );
    }
}
