import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.integration.test.ts'],
  testTimeout: 60000,
  moduleNameMapper: {
    '^@stripeonchain/shared$': '<rootDir>/../../packages/shared/src',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '../../tsconfig.base.json' }],
  },
};

export default config;
