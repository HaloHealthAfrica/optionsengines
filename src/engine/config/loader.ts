import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { logger } from '../../utils/logger.js';
import { ConfigValidationError } from '../types/errors.js';
import { validateConfig, type OptionsEngineConfig } from './schema.js';

function getDefaultConfigPath(): string {
  return join(process.cwd(), 'config', 'options-engine.yaml');
}

let _config: OptionsEngineConfig | null = null;

export function loadOptionsEngineConfig(configPath?: string): OptionsEngineConfig {
  const filePath = configPath ?? getDefaultConfigPath();

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(raw) as Record<string, unknown>;

    const errors = validateConfig(parsed);
    if (errors.length > 0) {
      throw new ConfigValidationError(errors);
    }

    _config = parsed as unknown as OptionsEngineConfig;
    logger.info('Options engine config loaded', { path: filePath });
    return _config;
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      logger.error('Options engine config validation failed', error, { errors: error.context.errors });
      throw error;
    }
    logger.error('Failed to load options engine config', error as Error, { path: filePath });
    throw new ConfigValidationError([`Failed to read config file: ${(error as Error).message}`]);
  }
}

export function getEngineConfig(): OptionsEngineConfig {
  if (!_config) {
    throw new ConfigValidationError(['Options engine config not loaded. Call loadOptionsEngineConfig() first.']);
  }
  return _config;
}

export function reloadConfig(configPath?: string): OptionsEngineConfig {
  _config = null;
  return loadOptionsEngineConfig(configPath);
}
