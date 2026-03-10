# Case Data Blockchain Interface Module

FISCO BCOS case data read/write interface for police write and court query.

## Dependencies

- JDK 11+
- Maven 3.6+
- FISCO BCOS chain built and running (see `blockchain-setup/`)

## Configuration

1. Copy chain SDK certs to `conf/`:
   - `ca.crt`
   - `sdk.crt`
   - `sdk.key`

2. Config file `src/main/resources/config.toml` (see `config-example.toml`):
   - `certPath`: cert directory, default `conf`
   - `peers`: node Channel address, e.g. `127.0.0.1:20200`

## Build

```bash
mvn clean compile
```

## API

### CaseDataWriteService (police write)

```java
CaseDataBlockchainClient client = new CaseDataBlockchainClient("config.toml");
CaseDataWriteService writeService = new CaseDataWriteService(client);
String txRef = writeService.writeCaseData(caseDataJson);
```

### CaseDataQueryService (court query)

```java
CaseDataBlockchainClient client = new CaseDataBlockchainClient("config.toml");
CaseDataQueryService queryService = new CaseDataQueryService(client);
String json = queryService.queryByCaseId("TEST-2025-001");
boolean ok = queryService.verifyIntegrity(json);
```

## Verification

After chain and console are ready and certs copied to `conf/`:

```bash
mvn exec:java -Dexec.mainClass="org.dissertation.blockchain.BlockchainVerificationTest" -Dexec.args="conf/config.toml"
```

Or run `BlockchainVerificationTest.main()` in IDE.

## Data Format

JSON must include:
- `caseId`: case ID (primary key)
- `examiner`: examiner name
- `aggregateHash`: integrity hash (SHA-256 of JSON with aggregateHash and aggregateHashNote empty)
