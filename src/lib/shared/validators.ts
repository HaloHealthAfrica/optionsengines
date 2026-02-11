import { z, ZodError } from 'zod';
import type { ErrorResponse, ValidationError } from './types.js';

export function formatZodError(error: ZodError): ValidationError[] {
  return error.issues.map((issue) => ({
    type: 'VALIDATION_ERROR',
    field: issue.path.join('.') || 'root',
    message: issue.message,
  }));
}

export function validationErrorResponse(error: ZodError): ErrorResponse {
  return {
    success: false,
    errors: formatZodError(error),
    timestamp: Date.now(),
  };
}

export function parseWithSchema<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; error: ErrorResponse } {
  const result = schema.safeParse(data);
  if (!result.success) {
    return { success: false, error: validationErrorResponse(result.error) };
  }
  return { success: true, data: result.data };
}
