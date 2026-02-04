-- Migration 000: Enable pgcrypto extension for UUID generation
-- Description: Required for gen_random_uuid()

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
