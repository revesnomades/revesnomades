-- Téléphone obligatoire pour créer un compte et réserver un séjour / événement

-- 1. Numéro sur le profil client et sur chaque réservation
alter table public.profiles add column if not exists phone text;
alter table public.bookings add column if not exists customer_phone text;

-- 2. Comptes déjà créés avec un numéro dans leurs données d'inscription : on le recopie sur le profil
update public.profiles p
   set phone = u.raw_user_meta_data->>'phone'
  from auth.users u
 where u.id = p.id
   and p.phone is null
   and coalesce(u.raw_user_meta_data->>'phone', '') <> '';

-- 3. Une cliente connectée peut créer SON profil s'il n'existe pas encore (compte créé avec Google).
--    Elle ne peut pas se donner le rôle admin.
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (id = auth.uid() and (role is null or role <> 'admin'));
