import { DeleteParameterCommand, GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { Global, Injectable, Module } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';

/**
 * Integration tokens (Meta, WhatsApp, portals, Google, Microsoft…) live in AWS SSM Parameter Store, encrypted,
 * never in the database or code (architecture §6.5). The database keeps only the parameter path (secret_ref).
 */
export interface SecretStore {
  get(path: string): Promise<string | undefined>;
  put(path: string, value: string): Promise<void>;
  delete(path: string): Promise<void>;
}
export const SECRET_STORE = Symbol('SECRET_STORE');

export class SsmSecretStore implements SecretStore {
  private readonly ssm: SSMClient;

  constructor(region: string) {
    this.ssm = new SSMClient({ region });
  }

  async get(path: string) {
    try {
      const out = await this.ssm.send(new GetParameterCommand({ Name: path, WithDecryption: true }));
      return out.Parameter?.Value;
    } catch (err) {
      if ((err as { name?: string }).name === 'ParameterNotFound') return undefined;
      throw err;
    }
  }

  async put(path: string, value: string) {
    await this.ssm.send(new PutParameterCommand({ Name: path, Value: value, Type: 'SecureString', Overwrite: true }));
  }

  async delete(path: string) {
    await this.ssm.send(new DeleteParameterCommand({ Name: path })).catch((err: { name?: string }) => {
      if (err.name !== 'ParameterNotFound') throw err;
    });
  }
}

/** Local development and tests: secrets kept in memory (lost on restart). Never used in staging or production. */
export class MemorySecretStore implements SecretStore {
  readonly values = new Map<string, string>();
  async get(path: string) {
    return this.values.get(path);
  }
  async put(path: string, value: string) {
    this.values.set(path, value);
  }
  async delete(path: string) {
    this.values.delete(path);
  }
}

@Injectable()
export class SecretPaths {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** e.g. /crm/production/tenants/<tenant>/integrations/<integration> */
  integration(tenantId: string, integrationId: string): string {
    return `/crm/${this.config.NODE_ENV}/tenants/${tenantId}/integrations/${integrationId}`;
  }
}

@Global()
@Module({
  providers: [
    {
      provide: SECRET_STORE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): SecretStore =>
        config.SECRETS_MODE === 'ssm' ? new SsmSecretStore(config.S3_REGION) : new MemorySecretStore(),
    },
    SecretPaths,
  ],
  exports: [SECRET_STORE, SecretPaths],
})
export class SecretsModule {}
