'use strict';

/**
 * Regenerates test/fixtures/autopsy-aggregate-samples.jsonl from integrity.computeHash
 * plus canonicalUtf8Base64 (JSON.stringify after sortKeysDeep) for byte-exact Java cross-tests.
 */

const fs = require('fs');
const path = require('path');

const integrity = require('../src/services/integrity');

const OUT = path.join(__dirname, '..', 'test', 'fixtures', 'autopsy-aggregate-samples.jsonl');

/** Same algorithm as api-gateway/src/services/integrity.js (before SHA-256). */
function sortKeysDeep(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  const sorted = {};
  for (const k of Object.keys(value).sort()) {
    sorted[k] = sortKeysDeep(value[k]);
  }
  return sorted;
}

function canonicalJsonString(caseJson) {
  const j = JSON.parse(caseJson);
  j.aggregateHash = '';
  j.aggregateHashNote = '';
  return JSON.stringify(sortKeysDeep(j));
}

const samples = [
  {
    id: 'AUT-S01',
    description: 'minimal_autopsy_shape_empty_arrays_z_before_caseId_key_order',
    obj: {
      zStress: 'sorted_after_deep_sort',
      caseId: 'CASE-MIN-001',
      caseDisplayName: 'Minimal',
      examiner: 'examiner-a',
      createdDate: '2026-01-01 00:00:00',
      operations: [],
      dataSources: [],
      files: [],
      aggregateHash:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      aggregateHashNote: 'placeholder before gateway canonical hash'
    }
  },
  {
    id: 'AUT-S02',
    description: 'operations_one_entry_unicode_and_quotes_in_detail',
    obj: {
      caseId: 'CASE-Unicode-卷宗',
      caseDisplayName: '演示案件 \u2022 中文',
      examiner: '法医-张三',
      createdDate: '2026-04-21 14:00:00',
      operations: [
        {
          time: '2026-04-21 14:01:00',
          action: 'OPEN_CASE',
          operator: '张三',
          detail: 'path: C:\\Evidence\\case.ad1  quote: "x"'
        }
      ],
      dataSources: [],
      files: [],
      aggregateHash: '',
      aggregateHashNote: ''
    }
  },
  {
    id: 'AUT-S03',
    description: 'dataSources_with_paths_and_file_row',
    obj: {
      caseId: '',
      caseDisplayName: '',
      examiner: '',
      createdDate: '',
      operations: [],
      dataSources: [
        {
          name: 'disk.E01',
          paths: ['D:/images/disk.E01'],
          md5: 'd41d8cd98f00b204e9800998ecf8427e',
          sha256: ''
        }
      ],
      files: [
        {
          name: '$MFT',
          path: '/img1/$MFT',
          size: 0,
          created: '',
          modified: '',
          accessed: '',
          changed: '',
          isDir: false,
          deleted: false,
          allocated: true,
          known: 'unknown',
          mimeType: '',
          md5: '',
          sha256: ''
        }
      ],
      aggregateHash: '00',
      aggregateHashNote: 'x'
    }
  },
  {
    id: 'AUT-S04',
    description: 'nested_object_under_custom_field_arrays_of_mixed_types',
    obj: {
      caseId: 'NEST',
      caseDisplayName: 'nest',
      examiner: 'e',
      createdDate: '2026-01-02',
      meta: { z: 1, a: { m: 2, b: 3 } },
      operations: [],
      dataSources: [],
      files: [],
      tags: [1, { u: 1, t: 0 }],
      aggregateHash: 'bad',
      aggregateHashNote: 'bad'
    }
  },
  {
    id: 'AUT-S05',
    description: 'scientific_notation_and_large_integer_numbers',
    obj: {
      caseId: 'NUM',
      caseDisplayName: 'n',
      examiner: 'e',
      createdDate: '2026-01-03',
      operations: [],
      dataSources: [],
      files: [],
      stats: { pi: 3.14, big: 9007199254740991, neg: -1 },
      aggregateHash: '1',
      aggregateHashNote: '2'
    }
  },
  {
    id: 'AUT-S06',
    description: 'empty_aggregate_fields',
    obj: {
      caseId: 'NULLISH',
      caseDisplayName: 'x',
      examiner: 'y',
      createdDate: 'z',
      operations: [],
      dataSources: [],
      files: [],
      aggregateHash: '',
      aggregateHashNote: ''
    }
  },
  {
    id: 'AUT-S07',
    description: 'string_escapes_control_chars',
    obj: {
      caseId: 'ESC',
      caseDisplayName: 'e',
      examiner: 'e',
      createdDate: '2026-01-04',
      operations: [],
      dataSources: [],
      files: [],
      msg: 'line1\nline2\t tab "quotes" \\ slash \r\n end',
      aggregateHash: 'x',
      aggregateHashNote: 'y'
    }
  },
  {
    id: 'AUT-S08',
    description: 'null_true_false_in_object',
    obj: {
      caseId: 'BOOL',
      ok: true,
      fail: false,
      empty: null,
      operations: [],
      dataSources: [],
      files: [],
      aggregateHash: '',
      aggregateHashNote: ''
    }
  },
  {
    id: 'AUT-S09',
    description: 'unicode_object_keys',
    obj: {
      键名: 'value-for-unicode-key',
      caseId: 'KEY',
      examiner: 'e',
      createdDate: 'd',
      operations: [],
      dataSources: [],
      files: [],
      aggregateHash: '',
      aggregateHashNote: ''
    }
  },
  {
    id: 'AUT-S10',
    description: 'supplementary_plane_emoji_in_string',
    obj: {
      caseId: 'EMOJI',
      icon: '😀',
      examiner: 'e',
      createdDate: 'd',
      operations: [],
      dataSources: [],
      files: [],
      aggregateHash: '',
      aggregateHashNote: ''
    }
  }
];

const lines = [];
for (const s of samples) {
  const caseJson = JSON.stringify(s.obj);
  const expectedGatewayAggregateHash = integrity.computeHash(caseJson);
  const canon = canonicalJsonString(caseJson);
  const canonicalUtf8Base64 = Buffer.from(canon, 'utf8').toString('base64');
  lines.push(
    JSON.stringify({
      id: s.id,
      description: s.description,
      caseJson,
      expectedGatewayAggregateHash,
      canonicalUtf8Base64
    })
  );
}
fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
process.stdout.write(`Wrote ${lines.length} samples to ${OUT}\n`);
