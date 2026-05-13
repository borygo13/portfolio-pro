import { Shell, PageHeader, Card, FeatureNote } from '@/components/Shell'
import { Coins } from 'lucide-react'

export default function CryptoPage() {
  return (
    <Shell>
      <PageHeader eyebrow="Crypto" title="Crypto portfolio" description="Na start ręczne wpisywanie lub CSV. Później można dodać API giełdy." />
      <Card>
        <Coins className="mb-4 text-cyan-300" size={34} />
        <h3 className="text-xl font-bold text-white">Moduł crypto</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Będzie osobno od long-term i CFD. Dzięki temu krypto nie rozwala statystyk inwestycji długoterminowych.</p>
        <FeatureNote>Funkcje później: import CSV, portfele, koszt nabycia, P/L, alokacja i historia transakcji.</FeatureNote>
      </Card>
    </Shell>
  )
}
