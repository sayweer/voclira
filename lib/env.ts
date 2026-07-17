import { VocliraError } from '@/lib/errors'

/**
 * Read a required server-side environment variable, throwing if it is missing.
 *
 * Used to eliminate silent devnet/localhost fallbacks: a missing critical var
 * must fail loudly (500 at runtime, or at boot via instrumentation.ts) rather
 * than quietly connecting to the wrong network in production.
 */
export function requireServerEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new VocliraError(
      `Missing required environment variable: ${name}`,
      'CONFIG_ERROR',
      500
    )
  }
  return value
}
