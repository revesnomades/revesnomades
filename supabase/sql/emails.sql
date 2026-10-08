-- Emails IA : désinscriptions + historique des envois
create table if not exists public.email_unsubscribes (
  email text primary key,
  created_at timestamptz not null default now()
);
alter table public.email_unsubscribes enable row level security;
-- Pas de policy : seules les fonctions Supabase (clé service) y accèdent.

create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  subject text not null,
  preheader text,
  body_html text,
  audiences text[],
  recipients_count integer,
  sent_by uuid references auth.users(id) on delete set null
);
alter table public.email_campaigns enable row level security;

drop policy if exists "email_campaigns_select_admin" on public.email_campaigns;
create policy "email_campaigns_select_admin" on public.email_campaigns
  for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
