import { NextRequest } from 'next/server'

// Base58 character set (Bitcoin alphabet)
const BASE58_REGEX = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/

/**
 * Validates that a string is a plausible Solana wallet address.
 * Must be 32-44 characters, base58-encoded.
 */
export function isValidWalletAddress(address: string): boolean {
  if (!address || address.length < 32 || address.length > 44) return false
  return BASE58_REGEX.test(address)
}

/**
 * Validates that a string is a plausible Solana transaction signature.
 * Must be 64-88 characters, base58-encoded.
 */
export function isValidTxSignature(signature: string): boolean {
  if (!signature || signature.length < 64 || signature.length > 88) return false
  return BASE58_REGEX.test(signature)
}

/**
 * Validates that a price is within acceptable range (bounds live in lib/limits.ts).
 */
export { isValidPriceLamports as isValidPrice } from '@/lib/limits'

/**
 * Safely parse JSON body from a request.
 * Returns null if parsing fails.
 */
export async function safeParseJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as T
  } catch {
    return null
  }
}

/**
 * Extract client IP from request headers.
 * Uses x-forwarded-for (set by proxies/Vercel), falls back to 'unknown'.
 */
export function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}
