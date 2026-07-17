/**
 * Runs once when the Node.js server boots (Next.js instrumentation hook).
 *
 * Fail-fast deploy guard: in production, a missing critical env var throws here —
 * at the first cold start — instead of surfacing as a confusing runtime 500 (or,
 * worse, a silent devnet/misconfigured fallback) deep inside a user flow.
 */
export async function register() {
  // Only the Node.js runtime has access to these server secrets; skip edge + dev.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NODE_ENV !== 'production') return

  const required = [
    'SOLANA_RPC_URL',
    'PLATFORM_WALLET',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'GROQ_API_KEY',
    'FAL_KEY',
    'R2_ACCOUNT_ID',
    'R2_ENDPOINT',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_PUBLIC_BUCKET',
    'R2_PRIVATE_BUCKET',
    'R2_PUBLIC_URL',
  ]

  const missing = required.filter((name) => !process.env[name])
  if (missing.length > 0) {
    throw new Error(
      `[Voclira] Missing required environment variables in production: ${missing.join(', ')}`
    )
  }
}
