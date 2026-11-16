-- Devis, factures et avoirs Âmes Nomades (espace admin).
-- À lancer dans Supabase : SQL Editor. Le script peut être relancé sans risque.
--
-- Règles garanties par la base (et pas seulement par la page) :
--   • numéro attribué seulement à la validation, à la suite, sans trou, par année et par type
--     (D-2026-0001 pour les devis, F-2026-0001 pour les factures, A-2026-0001 pour les avoirs) ;
--   • une fois validé, le contenu d'un document ne peut plus être modifié ni supprimé ;
--     une facture se corrige par un avoir ;
--   • les totaux sont recalculés par la base à partir des lignes ;
--   • accès réservé aux administrateurs.

-- ════════ 1. Qui est administrateur ════════
create or replace function public.billing_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(lower(auth.jwt() ->> 'email') in ('contact@amesnomades.com', 'sarnelli.ap@gmail.com', 'revesnomades@gmail.com'), false)
      or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ════════ 2. Réglages (coordonnées de l'entreprise, conditions par défaut) ════════
create table if not exists public.billing_settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.billing_settings enable row level security;
drop policy if exists billing_settings_admin on public.billing_settings;
create policy billing_settings_admin on public.billing_settings
  for all to authenticated using (public.billing_is_admin()) with check (public.billing_is_admin());

insert into public.billing_settings (id, data) values (1, jsonb_build_object(
  'name', 'Appoline Sarnelli',
  'trade_name', 'Âmes Nomades',
  'legal_form', 'Entrepreneur individuel (EI)',
  'address', '',
  'postal_code', '',
  'city', 'Montpellier',
  'country', 'France',
  'siret', '892 077 835 00023',
  'vat_number', 'FR25892077835',
  'email', 'contact@amesnomades.com',
  'phone', '+33 6 58 03 87 70',
  'website', 'amesnomades.com',
  'iban', '',
  'bic', '',
  'vat_mode', 'franchise',
  'default_vat_rate', 20,
  'payment_days', 30,
  'quote_validity_days', 30,
  'deposit_percent', 30,
  'payment_methods', 'Virement bancaire',
  'extra_mentions', ''
)) on conflict (id) do nothing;

-- ════════ 3. Documents ════════
create table if not exists public.billing_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('devis', 'facture', 'avoir')),
  status text not null default 'brouillon'
    check (status in ('brouillon', 'emis', 'accepte', 'refuse', 'payee', 'annulee')),
  number text unique,                       -- attribué à la validation
  issue_date date,                          -- date d'émission (fixée à la validation)
  due_date date,                            -- échéance (facture) ou fin de validité (devis)
  service_date text,                        -- date ou période de la prestation, en clair
  nature text not null default 'services' check (nature in ('services', 'biens', 'mixte')),
  client jsonb not null default '{}'::jsonb,
  lines jsonb not null default '[]'::jsonb, -- [{ description, quantity, unit, unit_price, vat_rate }]
  vat_mode text not null default 'franchise' check (vat_mode in ('franchise', 'assujetti')),
  total_ht numeric(12,2) not null default 0,
  total_tva numeric(12,2) not null default 0,
  total_ttc numeric(12,2) not null default 0,
  deposit_percent numeric(5,2) not null default 0,  -- acompte demandé (devis)
  already_paid numeric(12,2) not null default 0,    -- acompte déjà reçu (facture)
  notes text,                               -- visible sur le document
  terms text,                               -- conditions de paiement visibles
  internal_note text,                       -- note privée, jamais imprimée
  seller jsonb,                             -- coordonnées de l'entreprise figées à la validation
  source_id uuid references public.billing_documents(id) on delete restrict, -- devis d'origine, ou facture d'un avoir
  paid_at date,
  payment_method text,
  sent_at timestamptz,
  sent_to text,
  accepted_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists billing_documents_kind_idx on public.billing_documents (kind, status);
create index if not exists billing_documents_created_idx on public.billing_documents (created_at desc);
create index if not exists billing_documents_source_idx on public.billing_documents (source_id);

alter table public.billing_documents enable row level security;
drop policy if exists billing_documents_admin on public.billing_documents;
create policy billing_documents_admin on public.billing_documents
  for all to authenticated using (public.billing_is_admin()) with check (public.billing_is_admin());

-- Compteurs de numérotation : uniquement via billing_finalize
create table if not exists public.billing_counters (
  kind text not null,
  year int not null,
  last int not null default 0,
  primary key (kind, year)
);
alter table public.billing_counters enable row level security;

-- ════════ 4. Calcul des totaux ════════
-- Chaque ligne : montant HT arrondi au centime ; TVA calculée par taux sur le total HT de ce taux.
create or replace function public.billing_totals(p_lines jsonb, p_vat_mode text)
returns table (total_ht numeric, total_tva numeric, total_ttc numeric)
language sql
immutable
as $$
  with l as (
    select round(round(coalesce((x ->> 'quantity')::numeric, 0), 3) * round(coalesce((x ->> 'unit_price')::numeric, 0), 2), 2) as ht,
           case when p_vat_mode = 'assujetti' then round(coalesce((x ->> 'vat_rate')::numeric, 0), 2) else 0 end as rate
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
  ), by_rate as (
    select rate, sum(ht) as ht from l group by rate
  )
  select coalesce(sum(ht), 0)::numeric(12,2),
         coalesce(sum(round(ht * rate / 100, 2)), 0)::numeric(12,2),
         (coalesce(sum(ht), 0) + coalesce(sum(round(ht * rate / 100, 2)), 0))::numeric(12,2)
    from by_rate;
$$;

-- ════════ 5. Protection des documents ════════
create or replace function public.billing_protect()
returns trigger
language plpgsql
as $$
declare
  finalizing boolean := coalesce(current_setting('billing.finalizing', true), '') = 'on';
  t record;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'brouillon' then
      raise exception 'Un document validé ne peut pas être supprimé (numéro %). Pour une facture, créez un avoir.', old.number;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    -- Tout document commence en brouillon, sans numéro
    new.status := 'brouillon';
    new.number := null;
    new.seller := null;
    new.paid_at := null; new.sent_at := null; new.sent_to := null; new.accepted_at := null;
  elsif old.status = 'brouillon' then
    if not finalizing and (new.status <> 'brouillon' or new.number is distinct from old.number or new.seller is distinct from old.seller) then
      raise exception 'Utilisez « Valider » pour numéroter un document.';
    end if;
  else
    -- Document validé : le contenu est figé
    if (new.kind, new.number, new.issue_date, new.due_date, new.service_date, new.nature, new.client, new.lines, new.vat_mode,
        new.deposit_percent, new.already_paid, new.notes, new.terms, new.seller, new.source_id)
       is distinct from
       (old.kind, old.number, old.issue_date, old.due_date, old.service_date, old.nature, old.client, old.lines, old.vat_mode,
        old.deposit_percent, old.already_paid, old.notes, old.terms, old.seller, old.source_id) then
      raise exception 'Le document % est validé : son contenu ne peut plus être modifié.', old.number;
    end if;
    if new.status is distinct from old.status then
      if new.status = 'brouillon' then
        raise exception 'Un document validé ne peut pas redevenir un brouillon.';
      elsif old.kind = 'devis' and new.status not in ('emis', 'accepte', 'refuse') then
        raise exception 'Statut impossible pour un devis.';
      elsif old.kind = 'avoir' and new.status <> 'emis' then
        raise exception 'Statut impossible pour un avoir.';
      elsif old.kind = 'facture' and new.status not in ('emis', 'payee', 'annulee') then
        raise exception 'Statut impossible pour une facture.';
      elsif old.kind = 'facture' and (new.status = 'annulee' or old.status = 'annulee') and not finalizing then
        raise exception 'Une facture s''annule uniquement par un avoir.';
      end if;
    end if;
  end if;

  -- Totaux toujours recalculés à partir des lignes
  select * into t from public.billing_totals(new.lines, new.vat_mode);
  new.total_ht := t.total_ht; new.total_tva := t.total_tva; new.total_ttc := t.total_ttc;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists billing_protect_trg on public.billing_documents;
create trigger billing_protect_trg
  before insert or update or delete on public.billing_documents
  for each row execute function public.billing_protect();

-- ════════ 6. Validation : numéro, dates, coordonnées figées ════════
create or replace function public.billing_finalize(p_id uuid)
returns public.billing_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.billing_documents;
  s jsonb;
  today date := (now() at time zone 'Europe/Paris')::date;
  y int;
  n int;
  prefix text;
  credited numeric;
  src public.billing_documents;
begin
  if not public.billing_is_admin() then
    raise exception 'Accès réservé aux administrateurs.';
  end if;
  select * into d from public.billing_documents where id = p_id for update;
  if not found then raise exception 'Document introuvable.'; end if;
  if d.status <> 'brouillon' then raise exception 'Ce document est déjà validé (numéro %).', d.number; end if;
  if coalesce(trim(d.client ->> 'name'), '') = '' then raise exception 'Indiquez le nom du client.'; end if;
  if jsonb_array_length(coalesce(d.lines, '[]'::jsonb)) = 0 then raise exception 'Ajoutez au moins une ligne.'; end if;
  if exists (select 1 from jsonb_array_elements(d.lines) x where coalesce(trim(x ->> 'description'), '') = '') then
    raise exception 'Chaque ligne doit avoir une description.';
  end if;
  if d.kind = 'avoir' and d.source_id is null then raise exception 'Un avoir doit se rapporter à une facture.'; end if;

  select data into s from public.billing_settings where id = 1;
  s := coalesce(s, '{}'::jsonb);
  if coalesce(trim(s ->> 'address'), '') = '' or coalesce(trim(s ->> 'siret'), '') = '' then
    raise exception 'Complétez d''abord l''adresse et le SIRET de l''entreprise dans les réglages.';
  end if;

  -- Date d'émission = jour de la validation : la numérotation suit ainsi toujours l'ordre chronologique
  d.issue_date := today;
  y := extract(year from d.issue_date)::int;
  prefix := case d.kind when 'devis' then 'D' when 'facture' then 'F' else 'A' end;

  -- Compteur verrouillé : deux validations simultanées ne peuvent pas obtenir le même numéro
  insert into public.billing_counters (kind, year, last) values (d.kind, y, 1)
    on conflict (kind, year) do update set last = public.billing_counters.last + 1
    returning last into n;

  perform set_config('billing.finalizing', 'on', true);
  update public.billing_documents set
    status = 'emis',
    number = prefix || '-' || y || '-' || lpad(n::text, 4, '0'),
    issue_date = d.issue_date,
    due_date = coalesce(d.due_date, case
      when d.kind = 'devis' then d.issue_date + coalesce((s ->> 'quote_validity_days')::int, 30)
      when d.kind = 'facture' then d.issue_date + coalesce((s ->> 'payment_days')::int, 30)
      else null end),
    seller = s
  where id = p_id
  returning * into d;

  -- Avoir : la facture d'origine est annulée quand les avoirs couvrent tout son montant
  if d.kind = 'avoir' then
    select * into src from public.billing_documents where id = d.source_id for update;
    select coalesce(sum(total_ttc), 0) into credited from public.billing_documents
      where kind = 'avoir' and source_id = d.source_id and status <> 'brouillon';
    if src.kind = 'facture' and src.status in ('emis', 'payee') and credited >= src.total_ttc then
      update public.billing_documents set status = 'annulee' where id = src.id;
    end if;
  end if;
  perform set_config('billing.finalizing', 'off', true);
  return d;
end;
$$;
revoke all on function public.billing_finalize(uuid) from public, anon;
grant execute on function public.billing_finalize(uuid) to authenticated;

-- ════════ Vérifications ════════
-- Derniers documents :  select number, kind, status, total_ttc, issue_date from public.billing_documents order by created_at desc limit 10;
-- Compteurs :           select * from public.billing_counters order by year desc, kind;
