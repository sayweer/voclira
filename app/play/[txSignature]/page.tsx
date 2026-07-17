import { getPurchaseByTxSignature, getPurchaseById, getCreatorByWallet } from '@/lib/supabase'
import PlayScreen from '@/components/screens/PlayScreen'
import Link from 'next/link'

interface PlayPageProps {
  params: {
    txSignature: string
  }
}

// The canonical purchase key is now the UUID (works for card purchases too);
// legacy links still carry a base58 tx_signature. The [txSignature] route
// segment stays for URL backward-compat — resolve by shape.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PlayPage({ params }: PlayPageProps) {
  const key = params.txSignature
  const purchase = UUID_RE.test(key)
    ? await getPurchaseById(key)
    : await getPurchaseByTxSignature(key)

  if (!purchase) {
    return <PlayScreen purchase={null} />
  }

  const creator = await getCreatorByWallet(purchase.creator_wallet)

  return (
    <PlayScreen 
      purchase={purchase} 
      creatorName={creator?.creator_name} 
    />
  )
}
