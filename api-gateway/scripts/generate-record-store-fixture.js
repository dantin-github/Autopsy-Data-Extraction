'use strict';

/**
 * Runs Java RecordStoreFixtureEmitter (CaseRecordStore.save) and copies output to
 * test/fixtures/java-case_record_store.json for recordStore interop tests.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const blockchainDir = path.join(repoRoot, 'blockchain');
const outFixture = path.join(__dirname, '..', 'test', 'fixtures', 'java-case_record_store.json');

function resolveMavenExecutable() {
  const explicit = process.env.HASH_COMPARE_MAVEN;
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }
  const home = process.env.MAVEN_HOME;
  if (home) {
    const bin = path.join(home, 'bin', process.platform === 'win32' ? 'mvn.cmd' : 'mvn');
    if (fs.existsSync(bin)) {
      return bin;
    }
  }
  const toolsDir = path.join(repoRoot, 'tools');
  if (fs.existsSync(toolsDir)) {
    const dirs = fs.readdirSync(toolsDir).filter((d) => d.startsWith('apache-maven-')).sort();
    for (let i = dirs.length - 1; i >= 0; i--) {
      const candidate = path.join(toolsDir, dirs[i], 'bin', process.platform === 'win32' ? 'mvn.cmd' : 'mvn');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function pickJavaHome() {
  if (process.env.HASH_COMPARE_JAVA_HOME && fs.existsSync(path.join(process.env.HASH_COMPARE_JAVA_HOME, 'bin', 'java.exe'))) {
    return process.env.HASH_COMPARE_JAVA_HOME;
  }
  const temurin17 = 'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.18.8-hotspot';
  if (process.platform === 'win32' && fs.existsSync(path.join(temurin17, 'bin', 'java.exe'))) {
    return temurin17;
  }
  return process.env.JAVA_HOME;
}

const tmp = path.join(os.tmpdir(), `case-record-store-fixture-${Date.now()}.json`);
const mvnExe = resolveMavenExecutable();
const mvnArgs = ['-q', '-P', 'record-store-fixture', 'exec:java'];
const env = { ...process.env, RECORD_STORE_FIXTURE_PATH: tmp };
const jh = pickJavaHome();
if (jh) {
  env.JAVA_HOME = jh;
}

let r;
if (process.platform === 'win32') {
  const prefix = mvnExe ? `"${mvnExe.replace(/"/g, '""')}"` : 'mvn';
  const line = `${prefix} ${mvnArgs.join(' ')}`;
  r = spawnSync(line, {
    cwd: blockchainDir,
    env,
    encoding: 'utf8',
    shell: true
  });
} else if (mvnExe) {
  r = spawnSync(mvnExe, mvnArgs, { cwd: blockchainDir, env, encoding: 'utf8' });
} else {
  r = spawnSync('mvn', mvnArgs, { cwd: blockchainDir, env, encoding: 'utf8' });
}

if (r.error || r.status !== 0) {
  console.error('Maven failed:', r.error || r.stderr || r.stdout);
  process.exit(1);
}

if (!fs.existsSync(tmp)) {
  console.error('Java did not create', tmp);
  process.exit(1);
}

fs.mkdirSync(path.dirname(outFixture), { recursive: true });
fs.copyFileSync(tmp, outFixture);
try {
  fs.unlinkSync(tmp);
} catch (_) {
  /* ignore */
}
console.log('Wrote', outFixture);
