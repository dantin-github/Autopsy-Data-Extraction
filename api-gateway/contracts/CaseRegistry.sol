pragma solidity ^0.5.10;

/**
 * CaseRegistry — 两方审批 + 哈希登记（§11.2）
 *
 * Phase 4 草案：用合约内 mapping 存 indexHash → recordHash，不依赖 Table 预编译，便于 solc 本地编译。
 * 后续 Phase 6 可将写入路径切换为 FISCO Table 预编译，REST 契约不变。
 */
contract CaseRegistry {
    enum Status { None, Pending, Approved, Rejected, Executed }

    struct Proposal {
        bytes32 indexHash;
        bytes32 oldRecordHash;
        bytes32 newRecordHash;
        address proposer;
        address approver;
        Status status;
        uint256 proposedAt;
        uint256 decidedAt;
        string reason;
    }

    address private owner;

    /// @notice 链上角色表（外部可查询）
    mapping(address => bool) public police;
    mapping(address => bool) public judges;

    /// proposalId → 审批单（不 public，避免 ABI 数量与 §8 验收漂移；读状态走链下事件或后续 getter）
    mapping(bytes32 => Proposal) private proposals;

    /// indexHash → 当前 recordHash（与 CRUD t_case_hash 语义对齐）
    mapping(bytes32 => bytes32) private recordHashes;

    event RecordCreated(bytes32 indexed indexHash, bytes32 recordHash, address creator);
    event ProposalCreated(bytes32 indexed proposalId, bytes32 indexed indexHash, address proposer);
    event ProposalApproved(bytes32 indexed proposalId, address approver);
    event ProposalRejected(bytes32 indexed proposalId, address approver, string reason);
    event ProposalExecuted(bytes32 indexed proposalId, bytes32 oldHash, bytes32 newHash);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyPolice() {
        require(police[msg.sender], "not police");
        _;
    }

    modifier onlyJudge() {
        require(judges[msg.sender], "not judge");
        _;
    }

    constructor() public {
        owner = msg.sender;
    }

    // --- 角色管理（部署后由 owner 调用 seed-roles 脚本） ---

    function addPolice(address a) public onlyOwner {
        require(a != address(0), "zero addr");
        police[a] = true;
    }

    function addJudge(address a) public onlyOwner {
        require(a != address(0), "zero addr");
        judges[a] = true;
    }

    // --- 写入：首次建案（取代 Phase 1 的 CRUD insert） ---

    function createRecord(bytes32 indexHash, bytes32 recordHash) public onlyPolice {
        require(indexHash != bytes32(0), "index zero");
        require(recordHash != bytes32(0), "record zero");
        require(recordHashes[indexHash] == bytes32(0), "exists");
        recordHashes[indexHash] = recordHash;
        emit RecordCreated(indexHash, recordHash, msg.sender);
    }

    function getRecordHash(bytes32 indexHash) public view returns (bytes32) {
        return recordHashes[indexHash];
    }

    /// @notice 与 §11.3 `proposals(id)` 对齐；ABI 第 11 个外部函数（S4.3 正向单测读字段）
    function getProposal(bytes32 proposalId)
        public
        view
        returns (
            bytes32 indexHash,
            bytes32 oldRecordHash,
            bytes32 newRecordHash,
            address proposer,
            address approver,
            uint8 status,
            uint256 proposedAt,
            uint256 decidedAt,
            string memory reason
        )
    {
        Proposal storage p = proposals[proposalId];
        return (
            p.indexHash,
            p.oldRecordHash,
            p.newRecordHash,
            p.proposer,
            p.approver,
            uint8(p.status),
            p.proposedAt,
            p.decidedAt,
            p.reason
        );
    }

    // --- 两方审批状态机 ---

    function propose(
        bytes32 proposalId,
        bytes32 indexHash,
        bytes32 oldHash,
        bytes32 newHash,
        string memory reason
    ) public onlyPolice {
        require(proposalId != bytes32(0), "proposal id zero");
        require(proposals[proposalId].status == Status.None, "proposal exists");
        require(indexHash != bytes32(0), "index zero");
        require(recordHashes[indexHash] == oldHash, "old mismatch");

        proposals[proposalId] = Proposal({
            indexHash: indexHash,
            oldRecordHash: oldHash,
            newRecordHash: newHash,
            proposer: msg.sender,
            approver: address(0),
            status: Status.Pending,
            proposedAt: block.timestamp,
            decidedAt: 0,
            reason: reason
        });
        emit ProposalCreated(proposalId, indexHash, msg.sender);
    }

    function approve(bytes32 proposalId) public onlyJudge {
        Proposal storage p = proposals[proposalId];
        require(p.status == Status.Pending, "not pending");
        require(msg.sender != p.proposer, "self approve");
        p.status = Status.Approved;
        p.approver = msg.sender;
        p.decidedAt = block.timestamp;
        emit ProposalApproved(proposalId, msg.sender);
    }

    function reject(bytes32 proposalId, string memory reason) public onlyJudge {
        Proposal storage p = proposals[proposalId];
        require(p.status == Status.Pending, "not pending");
        require(msg.sender != p.proposer, "self reject");
        p.status = Status.Rejected;
        p.approver = msg.sender;
        p.decidedAt = block.timestamp;
        p.reason = reason;
        emit ProposalRejected(proposalId, msg.sender, reason);
    }

    /// @dev 不变式：仅 Approved 且仅原 proposer 可执行；写回 recordHashes
    function execute(bytes32 proposalId) public onlyPolice {
        Proposal storage p = proposals[proposalId];
        require(p.status == Status.Approved, "not approved");
        require(msg.sender == p.proposer, "not proposer");

        bytes32 idx = p.indexHash;
        require(recordHashes[idx] == p.oldRecordHash, "record changed");

        bytes32 oldH = p.oldRecordHash;
        bytes32 newH = p.newRecordHash;
        recordHashes[idx] = newH;
        p.status = Status.Executed;
        emit ProposalExecuted(proposalId, oldH, newH);
    }
}
