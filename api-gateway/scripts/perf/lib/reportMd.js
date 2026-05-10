'use strict';

const fs = require('fs');
const path = require('path');

/** Max line width hint for Visualization ASCII bars */
const VIZ_COL = 40;

/** Build a proportional bar filled with █ and spaces to maxCols */
function vizBar(width01, label, maxCols = VIZ_COL) {
  const n = Math.max(1, Math.min(maxCols, Math.round(Number(width01) * maxCols)));
  return `${'█'.repeat(n)}${' '.repeat(maxCols - n)} ${label}`;
}

function writeSevenSectionReport(absPath, { titleLine, purpose, methodLines, resultTablesMarkdown, vizBlock, bullets, artifactsLines, crossrefsLines }) {
  const parts = [];
  parts.push(titleLine.trim());
  parts.push('');
  parts.push('## Purpose');
  parts.push('');
  parts.push(String(purpose).trim());
  parts.push('');
  parts.push('## Method');
  parts.push('');
  parts.push(methodLines.map((l) => String(l)).join('\n').trim());
  parts.push('');
  parts.push('## Results');
  parts.push('');
  parts.push(resultTablesMarkdown.trim());
  parts.push('');
  parts.push('## Visualization');
  parts.push('');
  parts.push(`\`\`\`\n${vizBlock.trim()}\n\`\`\``);
  parts.push('');
  parts.push('## Key observations');
  parts.push('');
  for (const b of bullets) {
    parts.push(`- ${String(b).trim()}`);
  }
  parts.push('');
  parts.push('## Artifacts & Repro');
  parts.push('');
  parts.push(artifactsLines.map((l) => String(l)).join('\n').trim());
  parts.push('');
  parts.push('## Cross-refs');
  parts.push('');
  parts.push(crossrefsLines.map((l) => String(l)).join('\n').trim());
  parts.push('');
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${parts.join('\n').trimEnd()}\n`, 'utf8');
}

module.exports = { vizBar, writeSevenSectionReport };
