export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@workers/(.*)$': '<rootDir>/src/workers/$1',
    '^@agents/(.*)$': '<rootDir>/src/agents/$1',
    '^@routes/(.*)$': '<rootDir>/src/routes/$1',
    '^@types/(.*)$': '<rootDir>/src/types/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/?(*.)+(spec|test).ts',
    'tests/e2e/**/*.test.ts',
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    'tests/e2e/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!tests/e2e/**/*.test.ts',
    '!tests/e2e/**/*.spec.ts',
    '!src/types/**',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/tests/e2e/setup.ts'],
};
