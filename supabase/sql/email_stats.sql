-- Statistiques des emails envoyés depuis l'administration (destinataires, ouvertures, clics).
-- À lancer une fois dans Supabase : SQL Editor. Le script peut être relancé sans risque.

-- Étiquette donnée à chaque envoi chez Brevo, pour retrouver ses chiffres
alter table public.email_campaigns add column if not exists brevo_tag text;
-- Derniers chiffres relevés chez Brevo (Brevo ne les garde que 90 jours : ils restent ici ensuite)
alter table public.email_campaigns add column if not exists stats jsonb;
alter table public.email_campaigns add column if not exists stats_at timestamptz;

create index if not exists email_campaigns_created_at_idx on public.email_campaigns (created_at desc);

-- Vérification : derniers envois et leurs chiffres
-- select created_at, subject, recipients_count, brevo_tag, stats, stats_at from public.email_campaigns order by created_at desc limit 10;
