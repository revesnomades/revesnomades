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
