import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { mplCore, create } from '@metaplex-foundation/mpl-core'
import { walletAdapterIdentity, type WalletAdapter } from '@metaplex-foundation/umi-signer-wallet-adapters'
import { generateSigner, publicKey as toUmiPublicKey } from '@metaplex-foundation/umi'
import { base58 } from '@metaplex-foundation/umi/serializers'
import { resolveClientRpcUrl } from '@/lib/solana-client'

export interface MintLicenseResult {
  nftMint: string
  txSignature: string
}

/**
 * Mint a Voice License NFT (Metaplex Core) signed by the creator's own wallet.
 *
 * The creator pays, signs, and receives the asset; the platform wallet is only
 * the updateAuthority (a public key — no server-side private key involved). The
 * on-chain `uri` points to walletAddress-keyed metadata, never the raw voice_id
 * (which would be leaked permanently if embedded on-chain).
 *
 * Dynamically imported so the heavy Metaplex bundle stays out of the initial
 * page load and only loads when a creator activates their license.
 */
export async function mintVoiceLicense(
  wallet: WalletAdapter,
  walletAddress: string
): Promise<MintLicenseResult> {
  const rpc = resolveClientRpcUrl()

  // Reuse the existing public config endpoint (same source the fan page uses)
  // instead of a separate NEXT_PUBLIC env var.
  const cfgRes = await fetch('/api/platform-config')
  if (!cfgRes.ok) throw new Error('Failed to load platform configuration')
  const { platformWallet } = (await cfgRes.json()) as { platformWallet?: string }
  if (!platformWallet) throw new Error('Platform wallet is not configured')

  const umi = createUmi(rpc).use(mplCore())
  umi.use(walletAdapterIdentity(wallet))

  const asset = generateSigner(umi)

  const { signature } = await create(umi, {
    asset,
    name: 'Voclira Voice License',
    uri: `${window.location.origin}/api/creator/license-metadata/${walletAddress}`,
    owner: toUmiPublicKey(walletAddress),
    updateAuthority: toUmiPublicKey(platformWallet),
  }).sendAndConfirm(umi)

  return {
    nftMint: asset.publicKey.toString(),
    txSignature: base58.deserialize(signature)[0],
  }
}
