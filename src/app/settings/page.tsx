import { Shell, PageHeader, Card, FeatureNote, TrustBadge } from '@/components/Shell'
import { Database, Download, KeyRound, ShieldCheck } from 'lucide-react'

export default function SettingsPage() {
  return (
    <Shell>
      <PageHeader eyebrow="System" title="Backup, Supabase i ustawienia" description="Tu będziemy trzymać eksport danych, konfigurację API, ustawienia walut i bezpieczeństwo." />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card><Database className="mb-4 text-violet-300" /><h3 className="text-lg font-bold text-white">Supabase</h3><p className="mt-2 text-sm leading-6 text-slate-400">Baza danych Postgres + logowanie email/hasło. Na start darmowy plan wystarczy.</p><div className="mt-4"><TrustBadge>Postgres export-ready</TrustBadge></div></Card>
        <Card><Download className="mb-4 text-cyan-300" /><h3 className="text-lg font-bold text-white">Eksport danych</h3><p className="mt-2 text-sm leading-6 text-slate-400">Docelowo przycisk eksportu CSV/JSON/XLSX dla całej aplikacji.</p></Card>
        <Card><KeyRound className="mb-4 text-emerald-300" /><h3 className="text-lg font-bold text-white">Logowanie</h3><p className="mt-2 text-sm leading-6 text-slate-400">Email + hasło, później opcjonalnie Google login.</p></Card>
      </div>
      <Card className="mt-6"><ShieldCheck className="mb-4 text-emerald-300" /><h3 className="text-lg font-bold text-white">Strategia backupu</h3><p className="mt-2 text-sm leading-6 text-slate-400">Dane mają być przenośne. Baza w Supabase, migracje SQL w repo, eksport z aplikacji i opcjonalny pg_dump.</p><FeatureNote>Na tym etapie to jeszcze demo UI. Następny milestone to podpięcie realnej bazy i autoryzacji.</FeatureNote></Card>
    </Shell>
  )
}
