import { describe, expect, it } from 'vitest';

import {
  AICardIntegrationConfigurationError,
  getAICardRuntimeConfig,
} from '@/server/aicard-integration-config';

describe('AI Card Agent runtime configuration', () => {
  it('keeps the legacy gateway available when runtime integration is absent', () => {
    expect(getAICardRuntimeConfig({ NODE_ENV: 'development' })).toBeNull();
  });

  it('accepts a complete local runtime configuration', () => {
    expect(getAICardRuntimeConfig({
      NODE_ENV: 'development',
      YOYOO_AICARD_ISSUER: 'http://127.0.0.1:3000',
      YOYOO_AICARD_CLIENT_ID: 'yoyoo_dev',
      YOYOO_AICARD_AUDIENCE: 'yoyoo',
    })).toEqual({
      issuer: 'http://127.0.0.1:3000',
      clientId: 'yoyoo_dev',
      audience: 'yoyoo',
    });
  });

  it('rejects a partially configured runtime authority', () => {
    expect(() => getAICardRuntimeConfig({
      NODE_ENV: 'development',
      YOYOO_AICARD_ISSUER: 'http://127.0.0.1:3000',
    })).toThrow(AICardIntegrationConfigurationError);
  });

  it('requires HTTPS for the runtime issuer in production', () => {
    expect(() => getAICardRuntimeConfig({
      NODE_ENV: 'production',
      YOYOO_AICARD_ISSUER: 'http://aicard.example.com',
      YOYOO_AICARD_CLIENT_ID: 'yoyoo_prod',
    })).toThrow(AICardIntegrationConfigurationError);
  });
});
