import { describe, expect, it } from 'vitest';

import {
  AICardIntegrationConfigurationError,
  getAICardProfileUrl,
  getAICardRuntimeConfig,
} from '@/server/aicard-integration-config';

describe('AI Card browser integration configuration', () => {
  it('omits the profile link when local auth has no browser integration', () => {
    expect(getAICardProfileUrl({
      NODE_ENV: 'production',
      YOYOO_HUMAN_AUTH_MODE: 'local',
    })).toBeNull();
  });

  it('does not mistake an Agent-only runtime configuration for browser integration', () => {
    expect(getAICardProfileUrl({
      NODE_ENV: 'development',
      YOYOO_HUMAN_AUTH_MODE: 'local',
      YOYOO_AICARD_ISSUER: 'http://127.0.0.1:3000',
      YOYOO_AICARD_CLIENT_ID: 'yoyoo_dev',
    })).toBeNull();
  });

  it('returns the central profile URL for a complete password-mode integration', () => {
    expect(getAICardProfileUrl({
      NODE_ENV: 'production',
      YOYOO_HUMAN_AUTH_MODE: 'password',
      YOYOO_AICARD_ISSUER: 'https://id.example.com',
      YOYOO_AICARD_CLIENT_ID: 'yoyoo_prod',
      YOYOO_AICARD_REDIRECT_URI: 'https://app.example.com/api/v1/auth/aicard/callback',
      YOYOO_AICARD_SESSION_SECRET: 'test-secret',
    })).toBe('https://id.example.com/me/card');
  });

  it('returns the central profile URL for AI Card-only browser integration', () => {
    expect(getAICardProfileUrl({
      NODE_ENV: 'production',
      YOYOO_HUMAN_AUTH_MODE: 'aicard',
      YOYOO_AICARD_ISSUER: 'https://id.example.com',
      YOYOO_AICARD_CLIENT_ID: 'yoyoo_prod',
      YOYOO_AICARD_REDIRECT_URI: 'https://app.example.com/auth/aicard/callback',
      YOYOO_AICARD_SESSION_SECRET: 'test-secret',
    })).toBe('https://id.example.com/me/card');
  });

  it('rejects an incomplete password-mode integration', () => {
    expect(() => getAICardProfileUrl({
      NODE_ENV: 'production',
      YOYOO_HUMAN_AUTH_MODE: 'password',
    })).toThrow(AICardIntegrationConfigurationError);
  });
});

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
