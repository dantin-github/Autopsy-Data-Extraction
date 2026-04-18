'use strict';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const root = path.join(__dirname, '..');
const examplePath = path.join(root, 'data', 'users.example.json');
const outPath = path.join(root, 'data', 'users.json');

async function main() {
  const raw = fs.readFileSync(examplePath, 'utf8');
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) {
    throw new Error('users.example.json must be a JSON array');
  }

  const out = [];
  for (const row of rows) {
    const { passwordPlain, passwordHash, ...rest } = row;
    if (passwordHash && !passwordPlain) {
      out.push(row);
      continue;
    }
    if (!passwordPlain || !String(passwordPlain).length) {
      throw new Error(`user ${row.username}: passwordPlain is required for seeding`);
    }
    const hash = await bcrypt.hash(String(passwordPlain), 12);
    out.push({ ...rest, passwordHash: hash });
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${out.length} users to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
