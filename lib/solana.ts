import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { TransactionVerificationError, VocliraError } from '@/lib/errors'
import { platformFeeLamports } from '@/lib/limits'

const connection = new Connection(
  process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
  'confirmed'
)

export async function verifyTransaction(
  txSignature: string,
  expectedRecipient: string,
  expectedTotalLamports: number,
  expectedBuyer: string
): Promise<boolean> {
  // Read platform wallet from env — required for fee verification
  const platformWallet = process.env.PLATFORM_WALLET
  if (!platformWallet) {
    throw new VocliraError('Platform wallet not configured', 'CONFIG_ERROR', 500)
  }

  // Same fee formula the client uses when building the transaction (lib/limits.ts).
  const platformFee = platformFeeLamports(expectedTotalLamports)
  const creatorAmount = expectedTotalLamports - platformFee

  const tx = await connection.getTransaction(txSignature, {
    maxSupportedTransactionVersion: 0,
  })

  if (tx === null) throw new TransactionVerificationError(txSignature)
  if (tx.meta?.err !== null && tx.meta?.err !== undefined) {
    throw new TransactionVerificationError(txSignature)
  }

  // Reject transactions that cannot be age-verified or are older than 5 minutes.
  // Solana also provides built-in replay protection: each transaction includes
  // a recentBlockhash which expires after ~2 minutes, making true replays
  // impossible at the protocol level. This check adds defense-in-depth.
  const blockTime = tx.blockTime
  if (!blockTime) {
    throw new VocliraError(
      'Transaction age could not be verified',
      'TX_UNVERIFIABLE',
      400
    )
  }

  const txAgeMs = Date.now() - blockTime * 1000
  if (txAgeMs > 5 * 60 * 1000) {
    throw new VocliraError(
      'Transaction too old',
      'TX_TOO_OLD',
      400
    )
  }

  const accountKeys = tx.transaction.message.getAccountKeys()
  const preBalances = tx.meta?.preBalances ?? []
  const postBalances = tx.meta?.postBalances ?? []

  // Helper: find account index by wallet address
  function findAccountIndex(wallet: string): number {
    for (let i = 0; i < accountKeys.length; i++) {
      const key = accountKeys.get(i)
      if (key && key.toBase58() === wallet) return i
    }
    return -1
  }

  // Verify creator received correct amount (±1 lamport tolerance)
  const creatorIndex = findAccountIndex(expectedRecipient)
  if (creatorIndex === -1) throw new TransactionVerificationError(txSignature)

  const creatorDiff = postBalances[creatorIndex] - preBalances[creatorIndex]
  if (creatorDiff < creatorAmount - 1) throw new TransactionVerificationError(txSignature)

  // Verify platform wallet received correct fee (±1 lamport tolerance)
  const platformIndex = findAccountIndex(platformWallet)
  if (platformIndex === -1) throw new TransactionVerificationError(txSignature)

  const platformDiff = postBalances[platformIndex] - preBalances[platformIndex]
  if (platformDiff < platformFee - 1) throw new TransactionVerificationError(txSignature)

  // Verify the buyer is the actual payer of this transaction.
  // Prevents an attacker from replaying someone else's past on-chain TX
  // with a forged buyerWallet in the request body. The buyer's balance
  // must have decreased by at least the full amount transferred (the TX
  // fee may also be deducted, so buyerDiff is typically slightly more negative).
  const buyerIndex = findAccountIndex(expectedBuyer)
  if (buyerIndex === -1) throw new TransactionVerificationError(txSignature)

  const buyerDiff = postBalances[buyerIndex] - preBalances[buyerIndex]
  if (buyerDiff > -(expectedTotalLamports - 1)) {
    throw new TransactionVerificationError(txSignature)
  }

  return true
}

/**
 * Verify an on-chain Voice License mint transaction.
 * Confirms the tx succeeded, that the authenticated creator wallet was the
 * fee payer (first signer), and that the claimed NFT mint (asset) account
 * actually appears in the transaction. This binds the stored nft_mint to a
 * transaction the creator genuinely signed — we never trust the client blindly.
 */
export async function verifyLicenseMint(
  txSignature: string,
  nftMint: string,
  signerWallet: string
): Promise<boolean> {
  const tx = await connection.getTransaction(txSignature, {
    maxSupportedTransactionVersion: 0,
  })

  if (tx === null) throw new TransactionVerificationError(txSignature)
  if (tx.meta?.err !== null && tx.meta?.err !== undefined) {
    throw new TransactionVerificationError(txSignature)
  }

  const accountKeys = tx.transaction.message.getAccountKeys()

  // Fee payer is always the first account key — must be the authenticated creator.
  const feePayer = accountKeys.get(0)
  if (!feePayer || feePayer.toBase58() !== signerWallet) {
    throw new TransactionVerificationError(txSignature)
  }

  // The minted asset account must be present in this transaction.
  let mintPresent = false
  for (let i = 0; i < accountKeys.length; i++) {
    if (accountKeys.get(i)?.toBase58() === nftMint) {
      mintPresent = true
      break
    }
  }
  if (!mintPresent) throw new TransactionVerificationError(txSignature)

  return true
}

export async function getWalletBalance(walletAddress: string): Promise<number> {
  try {
    const balance = await connection.getBalance(new PublicKey(walletAddress))
    return balance / LAMPORTS_PER_SOL
  } catch {
    throw new VocliraError('Failed to fetch wallet balance', 'WALLET_ERROR', 500)
  }
}

export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL
}

export function solToLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL)
}
