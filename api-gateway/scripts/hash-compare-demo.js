'use strict';

/**
 * Compare Node hashOnly.computeIndexHash with Java HashOnlyRecord.computeIndexHash
 * for the same UTF-8 string (default: "digital forensics").
 *
 * Usage:
 *   cd api-gateway && node scripts/hash-compare-demo.js
 *   cd api-gateway && node scripts/hash-compare-demo.js "custom phrase"
 *   cd api-gateway && npm run hash-compare
 *
 * If Maven is available (PATH, MAVEN_HOME, HASH_COMPARE_MAVEN, or repo tools/apache-maven-*)
 * and blockchain/pom.xml exists, also runs Java and checks MATCH.
 * Maven uses JAVA_HOME; set HASH_COMPARE_JAVA_HOME to force a JDK (e.g. JDK 11+).
 */

const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const hashOnly = require('../src/services/hashOnly');

/** Prefer Temurin JDK 17 when installed so mvn does not pick an older JAVA_HOME (e.g. Java 8). */
function pickJavaHomeForMvn() {
  const manual = process.env.HASH_COMPARE_JAVA_HOME;
  if (manual) return manual;

  const temurin17 = 'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.18.8-hotspot';
  if (fs.existsSync(path.join(temurin17, 'bin', 'java.exe'))) {
    return temurin17;
  }

  return process.env.JAVA_HOME;
}

/** Full path to mvn / mvn.cmd when not relying on PATH (IDE shells often omit user PATH). */
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

  const repoRoot = path.join(__dirname, '..', '..');
  const toolsDir = path.join(repoRoot, 'tools');
  if (fs.existsSync(toolsDir)) {
    const dirs = fs
      .readdirSync(toolsDir)
      .filter((d) => d.startsWith('apache-maven-'))
      .sort();
    for (let i = dirs.length - 1; i >= 0; i--) {
      const candidate = path.join(
        toolsDir,
        dirs[i],
        'bin',
        process.platform === 'win32' ? 'mvn.cmd' : 'mvn'
      );
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return tryResolveMvnFromPath();
}

/** First `mvn` / `mvn.cmd` on PATH (IDE shells often omit user PATH; `where` still sees system PATH). */
function tryResolveMvnFromPath() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('where mvn', { encoding: 'utf8', shell: true }).trim();
      const line = out.split(/\r?\n/).find((l) => /^[A-Za-z]:\\/.test(l.trim()));
      if (line && fs.existsSync(line.trim())) {
        return line.trim();
      }
    } else {
      const out = spawnSync('which', ['mvn'], { encoding: 'utf8' });
      if (out.status === 0 && out.stdout) {
        const p = out.stdout.trim().split('\n')[0];
        if (p && fs.existsSync(p)) {
          return p;
        }
      }
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

const phrase = process.argv[2] || 'digital forensics';

const nodeHash = hashOnly.computeIndexHash(phrase);

console.log('');
console.log('=== Hash compare (index_hash = SHA256(UTF-8 string), lowercase hex) ===');
console.log('INPUT=' + phrase);
console.log('NODE_INDEX_HASH=' + nodeHash);
console.log('');

const blockchainDir = path.join(__dirname, '..', '..', 'blockchain');
const javaHome = pickJavaHomeForMvn();
const mvnEnv = { ...process.env, HASH_COMPARE_INPUT: phrase };
if (javaHome) {
  mvnEnv.JAVA_HOME = javaHome;
}
const mvnArgs = ['-q', '-P', 'hash-compare', 'exec:java'];
const mvnExe = resolveMavenExecutable();
const win = process.platform === 'win32';

let r;
if (win) {
  // Paths with spaces (e.g. "Data extraction") break cmd.exe /c unless the whole command is one shell line.
  const prefix = mvnExe ? `"${mvnExe.replace(/"/g, '""')}"` : 'mvn';
  const line = `${prefix} ${mvnArgs.join(' ')}`;
  r = spawnSync(line, {
    cwd: blockchainDir,
    env: mvnEnv,
    encoding: 'utf8',
    shell: true
  });
} else if (mvnExe) {
  r = spawnSync(mvnExe, mvnArgs, {
    cwd: blockchainDir,
    env: mvnEnv,
    encoding: 'utf8'
  });
} else {
  r = spawnSync('mvn', mvnArgs, {
    cwd: blockchainDir,
    env: mvnEnv,
    encoding: 'utf8'
  });
}

if (r.error || r.status !== 0) {
  console.log('(Java/Maven step failed — only Node result above.)');
  if (r.error) {
    console.log('  Launch error: ' + r.error.message);
  } else if (r.status != null) {
    console.log('  Exit code: ' + r.status);
  }
  const errText = (r.stderr || '').trim() || (r.stdout || '').trim();
  if (errText) {
    console.log('  Maven output: ' + errText.slice(0, 600));
  }
  console.log('');
  console.log('  Fix: install JDK 11+ and Maven, add mvn to PATH, or unpack Maven under repo tools/apache-maven-*');
  console.log('  Optional env: MAVEN_HOME, HASH_COMPARE_MAVEN (full path to mvn / mvn.cmd), HASH_COMPARE_JAVA_HOME');
  console.log('  Manual: cd blockchain && mvn -q -P hash-compare exec:java');
  console.log('');
  console.log('Node uses SHA-256 over UTF-8 bytes, same rule as Java HashOnlyRecord.computeIndexHash.');
} else {
  const out = r.stdout || '';
  console.log(out.trim());
  const m = out.match(/JAVA_INDEX_HASH=([0-9a-f]{64})/i);
  const javaHash = m ? m[1].toLowerCase() : null;
  if (javaHash) {
    if (javaHash === nodeHash) {
      console.log('');
      console.log('RESULT: MATCH (Node and Java produce the same index_hash)');
    } else {
      console.log('');
      console.log('RESULT: MISMATCH');
      process.exitCode = 1;
    }
  }
  console.log('');
}
