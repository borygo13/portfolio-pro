import { Shell, PageHeader, Card, FeatureNote } from '@/components/Shell'
import { Coins } from 'lucide-react'

export default function CryptoPage() {
  return (
    <Shell>
      <PageHeader eyebrow="Crypto" title="Crypto portfolio" description="Zaawansowany moduł crypto będzie osobny. Kryptowaluty długoterminowe możesz dziś dodać jako aktywa w Long-term." />
      <Card>
        <Coins className="mb-4 text-cyan-300" size={34} />
        <h3 className="text-xl font-bold text-white">Moduł crypto</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Ten widok nie pokazuje przykładowych sald ani wyników. Realne BTC/ETH/BNB możesz prowadzić w portfelu long-term, gdzie działają ceny, backfill i wycena w PLN.</p>
        <FeatureNote>Funkcje później: osobny import CSV, portfele, koszt nabycia, P/L, alokacja i historia transakcji dla zaawansowanego crypto.</FeatureNote>
      </Card>
    </Shell>
  )
}
