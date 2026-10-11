import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { buildOpenApi } from '../src/main';
import { createTestApp } from './helpers';

// pnpm api:check — every endpoint the code serves must exist in api/openapi.yaml with the same operationId.
// The contract is larger than the code while modules are being built, so contract-only endpoints are reported, not failed.
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const PREFIX = '/api/v1';

type Paths = Record<string, Partial<Record<(typeof METHODS)[number], { operationId?: string }>>>;

describe('API contract (api/openapi.yaml)', () => {
  let app: INestApplication;
  let codePaths: Paths;
  let contractPaths: Paths;

  beforeAll(async () => {
    app = await createTestApp();
    codePaths = buildOpenApi(app).paths as Paths;
    contractPaths = parse(readFileSync(resolve(__dirname, '../../../api/openapi.yaml'), 'utf8')).paths;
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves only endpoints that are in the contract, with matching operationIds', () => {
    const problems: string[] = [];
    let implemented = 0;
    for (const [fullPath, ops] of Object.entries(codePaths)) {
      const path = fullPath.startsWith(PREFIX) ? fullPath.slice(PREFIX.length) : fullPath;
      for (const method of METHODS) {
        const op = ops[method];
        if (!op) continue;
        implemented++;
        const contractOp = contractPaths[path]?.[method];
        if (!contractOp) problems.push(`${method.toUpperCase()} ${path} is not in the contract`);
        else if (op.operationId !== contractOp.operationId)
          problems.push(`${method.toUpperCase()} ${path}: operationId ${op.operationId} should be ${contractOp.operationId}`);
      }
    }
    const total = Object.values(contractPaths).reduce((n, ops) => n + METHODS.filter((m) => ops[m]).length, 0);
    console.log(`api:check: ${implemented} of ${total} contract endpoints implemented`);
    expect(problems).toEqual([]);
  });
});
