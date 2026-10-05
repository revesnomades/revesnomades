-- Inscriptions « Me prévenir » : les visiteurs peuvent s'inscrire,
-- seuls les admins peuvent lire la liste (emails = données personnelles).
alter table public.restock_subscriptions enable row level security;

drop policy if exists "restock_insert_public" on public.restock_subscriptions;
drop policy if exists "restock_select_admin" on public.restock_subscriptions;

create policy "restock_insert_public" on public.restock_subscriptions
  for insert to anon, authenticated
  with check (true);

create policy "restock_select_admin" on public.restock_subscriptions
  for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
