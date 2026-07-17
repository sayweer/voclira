import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  ComputeBudgetProgram,
  TransactionExpiredBlockheightExceededError,
  clusterApiUrl,
} from '@solana/web3.js'
import type { WalletContextState } from '@solana/wallet-adapter-react'
import { TX } from '@/lib/limits'

/**
 * Resolve the client-side RPC endpoint.
 *
 * On mainnet-beta a real RPC URL is mandatory — the public
 * api.mainnet-beta.solana.com endpoint aggressively rate-limits getTransaction
 * and would break server-side verification. Rather than silently degrade, throw
 * so the misconfiguration surfaces immediately. Off mainnet, fall back to the
 * devnet cluster for local/staging convenience.
 */
export function resolveClientRpcUrl(): string {
  const url = process.env.NEXT_PUBLIC_SOLANA_RPC_URL
  if (url) return url
  if (process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'mainnet-beta') {
    throw new Error(
      'NEXT_PUBLIC_SOLANA_RPC_URL is required on mainnet-beta (the public RPC is rate-limited)'
    )
  }
  return clusterApiUrl('devnet')
}

export function getClientConnection(): Connection {
  return new Connection(resolveClientRpcUrl(), 'confirmed')
}

export interface PaymentTransfer {
  /** Recipient wallet, base58. */
  to: string
  lamports: number
}

/**
 * Build, send, and confirm the fan payment transaction with mainnet-grade
 * resilience:
 *  - a priority fee + compute-unit budget so it isn't dropped under congestion,
 *  - blockhash-bound confirmation (signature + lastValidBlockHeight), and
 *  - one automatic retry with a fresh blockhash if it expires before confirming.
 *
 * The wallet re-prompts for a signature on the retry. Returns the confirmed
 * transaction signature.
 */
export async function sendPaymentTransaction(params: {
  publicKey: PublicKey
  sendTransaction: WalletContextState['sendTransaction']
  transfers: PaymentTransfer[]
}): Promise<string> {
  const { publicKey, sendTransaction, transfers } = params
  const connection = getClientConnection()

  const buildTransaction = (blockhash: string): Transaction => {
    const tx = new Transaction()
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: TX.COMPUTE_UNIT_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: TX.PRIORITY_FEE_MICROLAMPORTS,
      })
    )
    for (const transfer of transfers) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(transfer.to),
          lamports: transfer.lamports,
        })
      )
    }
    tx.feePayer = publicKey
    tx.recentBlockhash = blockhash
    return tx
  }

  const attempt = async (): Promise<string> => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
    const transaction = buildTransaction(blockhash)
    const signature = await sendTransaction(transaction, connection)
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    )
    return signature
  }

  try {
    return await attempt()
  } catch (err) {
    if (err instanceof TransactionExpiredBlockheightExceededError) {
      // Blockhash expired before confirmation (congestion). Retry once with a
      // fresh blockhash — the wallet prompts for a second signature.
      return await attempt()
    }
    throw err
  }
}
