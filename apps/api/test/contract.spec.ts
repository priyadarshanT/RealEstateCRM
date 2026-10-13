import { INestApplication } from '@nestjs/common';
import { getMetadataStorage } from 'class-validator';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { IS_DATE_ONLY } from '../src/core/http/validators';
import { buildOpenApi } from '../src/main';
import { createTestApp, signIn, USERS } from './helpers';

// pnpm api:check — every endpoint the code serves must exist in api/openapi.yaml with the same operationId.
// The contract is larger than the code while modules are being built, so contract-only endpoints are reported, not failed.
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const PREFIX = '/api/v1';
// Where @ApiProperty stores a property's OpenAPI description (DECORATORS.API_MODEL_PROPERTIES in @nestjs/swagger).
const API_MODEL_PROPERTIES = 'swagger/apiModelProperties';

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

  // A date-only field (format: date) checked with IsDateString accepts timestamps, which then break the
  // YYYY-MM-DD → UTC day conversion and answer 500. Every validated date field must use IsDateOnly.
  it('validates every format: date input with IsDateOnly', () => {
    const storage = getMetadataStorage() as unknown as { validationMetadatas: Map<Function, { propertyName: string; name?: string }[]> };
    const missing: string[] = [];
    let checked = 0;
    for (const [target, metas] of storage.validationMetadatas) {
      for (const property of new Set(metas.map((m) => m.propertyName))) {
        const doc = Reflect.getMetadata(API_MODEL_PROPERTIES, target.prototype, property) as { format?: string } | undefined;
        if (doc?.format !== 'date') continue;
        checked++;
        if (!metas.some((m) => m.propertyName === property && m.name === IS_DATE_ONLY)) missing.push(`${target.name}.${property}`);
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it('answers 400, not 500, when a date filter gets a timestamp', async () => {
    const admin = await signIn(app, USERS.adminA);
    const urls = ['/api/v1/tasks?from=', '/api/v1/dashboard?to=', '/api/v1/reports/leads?from=', '/api/v1/leads?createdFrom=', '/api/v1/exports?to='];
    for (const url of urls) {
      const bad = await admin.get(`${url}2026-10-01T00:00:00.000Z`);
      expect({ url, status: bad.status, code: bad.body.code }).toEqual({ url, status: 400, code: 'VALIDATION_FAILED' });
      expect({ url, status: (await admin.get(`${url}2026-10-01`)).status }).toEqual({ url, status: 200 });
    }
    expect((await admin.get('/api/v1/tasks?from=2026-02-30')).status).toBe(400);
  });
});
