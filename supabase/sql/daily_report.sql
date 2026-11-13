-- Bilan quotidien Âmes Nomades : visites sans cookie + envoi chaque matin à 6 h (heure de Paris).
-- À lancer dans Supabase : SQL Editor. Le script peut être relancé sans risque.

-- ════════ 1. Visites des pages publiques ════════
-- Aucune adresse IP n'est enregistrée : seulement une empreinte qui change chaque jour.
create table if not exists public.site_visits (
  id bigint generated always as identity primary key,
  path text not null,                -- page vue
  referrer_host text,                -- site d'origine (première page de la visite)
  campaign text,                     -- utm_source
  device text,                       -- ordinateur | telephone | tablette
  visitor_hash text not null,        -- SHA-256(adresse IP + navigateur + date du jour)
  created_at timestamptz not null default now()
);
create index if not exists site_visits_created_at_idx on public.site_visits (created_at);
create index if not exists site_visits_dedupe_idx on public.site_visits (visitor_hash, path, created_at desc);

alter table public.site_visits enable row level security;
-- Aucune règle d'accès : lecture et écriture réservées au serveur (clé service).

-- Enregistre une visite, sauf doublon (même visiteur, même page, moins de 10 s)
-- et sauf dépassement du plafond d'écritures par minute.
create or replace function public.record_visit(p_path text, p_referrer text, p_campaign text, p_device text, p_hash text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from site_visits
              where visitor_hash = p_hash and path = p_path and created_at > now() - interval '10 seconds') then
    return 'doublon';
  end if;
  if (select count(*) from site_visits where created_at > now() - interval '1 minute') >= 300 then
    return 'plafond';
  end if;
  insert into site_visits (path, referrer_host, campaign, device, visitor_hash)
  values (left(p_path, 160), left(p_referrer, 100), left(p_campaign, 60), left(p_device, 20), p_hash);
  return 'ok';
end;
$$;
revoke all on function public.record_visit(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_visit(text, text, text, text, text) to service_role;

-- ════════ 2. Un seul bilan par jour ════════
-- La date du bilan est réservée avant l'envoi, puis libérée si l'envoi échoue.
create table if not exists public.daily_reports (
  report_date date primary key,
  status text not null default 'pending',   -- pending | sent
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.daily_reports enable row level security;
-- Aucune règle d'accès : réservé au serveur.

-- ════════ 3. Tâche planifiée ════════
-- Les tâches de la base tournent en UTC : deux déclenchements, à 4 h et 5 h UTC.
-- La fonction n'envoie que s'il est 6 h à Paris (4 h UTC en été, 5 h UTC en hiver).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Secret de la tâche : créé ici une seule fois, au hasard, et rangé dans le coffre de la base (Vault).
-- Il s'affiche à la fin du script : il reste à le copier dans Supabase > Edge Functions > Secrets,
-- sous le nom CRON_SECRET. Tant que ce n'est pas fait, la fonction refuse la tâche (rien n'est envoyé).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'cron_secret');
  end if;
end $$;
-- Pour le changer plus tard (puis mettre la même valeur dans CRON_SECRET) :
--   select vault.update_secret((select id from vault.secrets where name = 'cron_secret'), replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

do $$
begin
  if exists (select 1 from cron.job where jobname = 'bilan-quotidien-ames-nomades') then
    perform cron.unschedule('bilan-quotidien-ames-nomades');
  end if;
end $$;

select cron.schedule(
  'bilan-quotidien-ames-nomades',
  '0 4,5 * * *',
  $job$
  select net.http_post(
    url := 'https://qxrxwgrgjvesevjkjmry.supabase.co/functions/v1/daily-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- Supabase attend son propre jeton public dans Authorization ; le secret de la tâche voyage à côté
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4cnh3Z3JnanZlc2V2amtqbXJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczNzE4MTIsImV4cCI6MjA4Mjk0NzgxMn0.WQCWMfqGbhbdnYdkcpBAarVJBBstSFAK3_YYn5uNbKI',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);

-- ════════ Résultat : la valeur à copier dans Edge Functions > Secrets > CRON_SECRET ════════
select decrypted_secret as "CRON_SECRET (à copier dans Edge Functions > Secrets)"
  from vault.decrypted_secrets where name = 'cron_secret';

-- ════════ Vérifications utiles ════════
-- Tâche bien enregistrée :        select jobname, schedule, active from cron.job;
-- Derniers déclenchements :       select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
-- Réponses de la fonction :       select status_code, content, created from net._http_response order by created desc limit 5;
-- Bilans envoyés :                select * from public.daily_reports order by report_date desc limit 7;
-- Visites du jour :               select count(*), count(distinct visitor_hash) from public.site_visits where created_at > now() - interval '1 day';
