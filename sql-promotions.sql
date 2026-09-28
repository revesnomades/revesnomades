-- À exécuter dans Supabase → SQL Editor
-- Si la table existe déjà, ajouter seulement la colonne value_unit :
-- ALTER TABLE promotions ADD COLUMN IF NOT EXISTS value_unit text DEFAULT 'percent';

CREATE TABLE IF NOT EXISTS promotions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  name text NOT NULL,
  description text,
  type text NOT NULL DEFAULT 'percent' CHECK (type IN ('percent', 'fixed', 'duo', 'promo_code', 'early_bird')),
  value numeric NOT NULL DEFAULT 0,
  value_unit text NOT NULL DEFAULT 'percent' CHECK (value_unit IN ('percent', 'euro')),
  code text,
  eligible_product_ids uuid[] DEFAULT '{}',
  eligible_stay_ids uuid[] DEFAULT '{}',
  apply_to text NOT NULL DEFAULT 'all' CHECK (apply_to IN ('all', 'products', 'stays', 'specific')),
  min_qty integer DEFAULT 1,
  active boolean DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  display_badge boolean DEFAULT true,
  badge_text text,
  badge_color text DEFAULT '#cc4444',
  display_banner boolean DEFAULT false,
  banner_text text
);

-- Autoriser la lecture publique (pour panier + boutique)
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read promotions"
  ON promotions FOR SELECT
  USING (true);

CREATE POLICY "Admin write promotions"
  ON promotions FOR ALL
  USING (auth.role() = 'authenticated');
