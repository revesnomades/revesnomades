-- Bons cadeaux : à exécuter dans Supabase → SQL Editor → Run
-- 1. Tables
create table if not exists public.gift_cards (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  initial_amount numeric not null,
  balance numeric not null,
  status text not null default 'active',           -- active | used | cancelled
  expires_at timestamptz not null,
  buyer_email text,
  buyer_name text,
  recipient_name text,
  recipient_email text,
  message text,
  order_ref text,
  stripe_session_id text,
  claimed_by uuid references auth.users(id),       -- compte qui a enregistré le bon
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.gift_card_redemptions (
  id uuid primary key default gen_random_uuid(),
  gift_card_id uuid not null references public.gift_cards(id),
  session_id text not null,                        -- un paiement ne débite qu'une fois
  amount numeric not null,
  created_at timestamptz not null default now(),
  unique (session_id, gift_card_id)
);
alter table public.gift_cards enable row level security;
alter table public.gift_card_redemptions enable row level security;

-- 2. Un client voit les bons qu'il a enregistrés sur son compte
drop policy if exists "Lire mes bons cadeaux" on public.gift_cards;
create policy "Lire mes bons cadeaux" on public.gift_cards
  for select to authenticated using (claimed_by = auth.uid());

-- 3. Consulter un bon par son code (panier, invité ou connecté)
create or replace function public.gift_card_lookup(p_code text)
returns table (code text, initial_amount numeric, balance numeric, expires_at timestamptz, status text, recipient_name text)
language sql security definer set search_path = public stable as $$
  select g.code, g.initial_amount, g.balance, g.expires_at,
         case when g.status = 'active' and g.expires_at < now() then 'expired'
              when g.status = 'active' and g.balance <= 0 then 'used'
              else g.status end as status,
         g.recipient_name
    from gift_cards g
   where upper(regexp_replace(g.code, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'))
   limit 1
$$;
grant execute on function public.gift_card_lookup(text) to anon, authenticated;

-- 4. Enregistrer un bon sur son compte
create or replace function public.gift_card_claim(p_code text)
returns table (code text, initial_amount numeric, balance numeric, expires_at timestamptz, status text, recipient_name text)
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_owner uuid;
begin
  if auth.uid() is null then raise exception 'Connecte-toi pour enregistrer un bon cadeau.'; end if;
  select g.id, g.claimed_by into v_id, v_owner from gift_cards g
   where upper(regexp_replace(g.code, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'));
  if v_id is null then raise exception 'Ce code ne correspond à aucun bon cadeau.'; end if;
  if v_owner is not null and v_owner <> auth.uid() then raise exception 'Ce bon cadeau est déjà enregistré sur un autre compte.'; end if;
  update gift_cards set claimed_by = auth.uid(), claimed_at = coalesce(claimed_at, now()) where id = v_id;
  return query select * from gift_card_lookup(p_code);
end $$;
grant execute on function public.gift_card_claim(text) to authenticated;

-- 5. Débiter un bon après paiement (réservé au serveur : clé service)
create or replace function public.gift_card_redeem(p_session_id text, p_code text, p_amount numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_balance numeric;
begin
  select id, balance into v_id, v_balance from gift_cards
   where upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'))
   for update;
  if v_id is null then raise exception 'Bon cadeau introuvable'; end if;
  insert into gift_card_redemptions (gift_card_id, session_id, amount) values (v_id, p_session_id, p_amount)
  on conflict do nothing;
  if found then
    v_balance := greatest(0, v_balance - p_amount);
    update gift_cards set balance = v_balance, status = case when v_balance <= 0 then 'used' else status end where id = v_id;
  end if;
  return v_balance;
end $$;
revoke execute on function public.gift_card_redeem(text, text, numeric) from public, anon, authenticated;

-- 6. Bucket public pour les cartes cadeaux générées en image (envoyées par email)
insert into storage.buckets (id, name, public) values ('gift-cards', 'gift-cards', true)
on conflict (id) do update set public = true;
