---
name: Âmes Nomades
description: Retraites et séjours bien-être en France, et un shop d'objets bien-être éco-responsables.
colors:
  cream: "#faf5dc"
  white: "#fffdf3"
  text: "#1e1f22"
  muted: "#62666e"
  line: "rgba(30,31,34,.16)"
  accent: "#cc6f53"
  soon: "#6b6b6b"
  sold-out: "#1e1f22"
  nav-scrolled: "rgba(14,15,17,.62)"
  footer: "rgba(14,15,17,.72)"
  footer-light: "#ede5de"
  promo: "#cc4444"
  error: "#cc0000"
  error-bg: "#fff5f5"
  error-border: "#ffcccc"
  warning: "#b34400"
  on-dark: "#ffffff"
  ink: "#000000"
  overlay: "rgba(0,0,0,.25)"
  filter-border: "rgba(0,0,0,.15)"
  success: "#3f7a4c"
  success-bg: "#d4edda"
  success-text: "#155724"
  success-border: "#c3e6cb"
  danger: "#d9534f"
  gold: "#b19342"
  sand-50: "#faf6ee"
  sand-100: "#f5ebd7"
  sand-200: "#ede0c8"
  sand-line: "rgba(224,208,180,0.55)"
  sage: "#8a9a86"
  ink-soft: "#2d2e33"
  border-soft: "#e5e5e5"
  border-light: "#eeeeee"
  border-mid: "#dddddd"
  banner-default: "#1a1a1a"
  links-gold: "#d4c78d"
  links-ink: "#4b4532"
typography:
  display-hero:
    fontFamily: "SegoCustom, serif"
    fontSize: "56px"
    fontWeight: 400
    lineHeight: 1.05
  display:
    fontFamily: "SegoCustom, serif"
    fontSize: "42px"
    fontWeight: 400
    lineHeight: 1.15
  heading-1:
    fontFamily: "SegoCustom, serif"
    fontSize: "34px"
    fontWeight: 400
    lineHeight: 1.15
  heading-2:
    fontFamily: "SegoCustom, serif"
    fontSize: "26px"
    fontWeight: 400
    lineHeight: 1.2
  heading-3:
    fontFamily: "Glacial Indifference, Outfit, Segoe UI, Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.3
  lead:
    fontFamily: "Glacial Indifference, Outfit, Segoe UI, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 300
    lineHeight: 1.6
  body:
    fontFamily: "Glacial Indifference, Outfit, Segoe UI, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 300
    lineHeight: 1.75
    letterSpacing: "0.01em"
  body-small:
    fontFamily: "Glacial Indifference, Outfit, Segoe UI, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 300
    lineHeight: 1.65
  caption:
    fontFamily: "Glacial Indifference, Outfit, Segoe UI, Arial, sans-serif"
    fontSize: "13px"
    lineHeight: 1.6
  speaker-name:
    fontFamily: "Seasons, serif"
    fontSize: "22px"
    fontWeight: 400
  google-button:
    fontFamily: "Roboto, Arial, sans-serif"
    fontSize: "14px"
  emoji-decor:
    fontFamily: "inherit"
    fontSize: "48px"
  label:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "12px"
    letterSpacing: "0.12em"
rounded:
  none: "0"
  sm: "2px"
  md: "3px"
  control: "4px"
  control-account: "6px"
  dialog: "8px"
  modal: "12px"
  pill: "9999px"
spacing:
  xs: "8px"
  sm: "26px"
  md: "52px"
  lg: "80px"
  xl: "110px"
components:
  button:
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
    padding: "10px 16px"
    typography: "{typography.label}"
  button-add-cart:
    backgroundColor: "{colors.text}"
    textColor: "{colors.white}"
    rounded: "{rounded.sm}"
    padding: "14px 24px"
  badge-soon:
    backgroundColor: "{colors.soon}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
  badge-sold-out:
    backgroundColor: "{colors.sold-out}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
  favorite-button:
    backgroundColor: "rgba(255,255,255,.92)"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    size: "36px"
---

# Âmes Nomades — système visuel

## Overview

Un univers calme et lumineux : fonds crème chauds, texte presque noir, une seule couleur d'accent terracotta, beaucoup d'air. Le ton est apaisant, jamais « vendeur ». Les titres en capitales espacées (SegoCustom pour les grands titres, Glacial Indifference ailleurs) donnent l'élégance ; les libellés techniques (boutons, filtres) passent en IBM Plex Mono, petites capitales espacées. Les photos de séjours et de produits portent l'émotion ; l'interface s'efface derrière elles.

## Colors

- **Crème `#faf5dc` / blanc cassé `#fffdf3`** : fonds de page et de surfaces. C'est l'identité de la marque, pas un choix par défaut.
- **Texte `#1e1f22`** : tout le texte principal, les boutons pleins.
- **Gris secondaire `#62666e`** (`--muted`) : textes d'appoint. Assombri depuis `#6c7078` pour atteindre 4,5:1 sur crème et sur `#ede5de`.
- **Terracotta `#cc6f53`** (`--accent`) : favoris actifs, compteurs du panier et des favoris. À réserver aux signaux ; ne jamais l'utiliser pour du texte courant (3,2:1 sur crème).
- **Gris « Bientôt disponible » `#6b6b6b`** (`--soon`) et **noir « SOLD OUT » `#1e1f22`** (`--sold-out`) : badges de disponibilité, texte blanc (≥ 5,3:1).
- **Menu** : fond `rgba(14,15,17,.62)` dès le chargement sur les pages claires (`body.on-light`), pour garder le texte blanc lisible (≥ 5,1:1). Sur l'accueil, plus transparent au-dessus de la photo.
- **Pied de page** : `rgba(14,15,17,.72)`, texte blanc à 72–92 %.
- **Promo `#cc4444`** : badges de réduction uniquement. **Erreur `#cc0000`** sur fond `#fff5f5` : messages d'erreur des formulaires.
- **Pied de page clair `#ede5de`** : variante de pied de page sur certaines pages.
- **Page liens** : fond doré `#d4c78d`, texte `#4b4532` (≥ 5:1). **Bannière promo** : `#1a1a1a` par défaut, réglable dans l'admin.
- **Succès** `#3f7a4c` (bouton, texte blanc 5,1:1), messages de succès sur `#d4edda` ; **danger** `#d9534f` pour les actions destructrices de l'espace compte.
- **Sable** `#faf6ee` → `#ede0c8` et **sauge** `#8a9a86` : dégradés et accents de l'accueil. Jamais pour du texte courant.

## Typography

- **Grands titres** : SegoCustom, capitales, poids 400, interlignage serré (1,15). Page produit : 34px (26px sur mobile).
- **Texte courant** : Glacial Indifference 300, interlignage 1,75, léger espacement (0,01em).
- **Libellés de boutons et filtres** : IBM Plex Mono 11–13px, capitales, espacement 0,08–0,12em.
- Les prix utilisent des chiffres tabulaires quand ils sont alignés en colonne.
- **Échelle des tailles** : 12 · 13 · 14 · 16 · 18 · 22 · 26 · 34 · 42 · 56 px. 56px est réservé aux grands titres de page (accueil, séjour, événement, merci) ; les titres fluides (`clamp`) partent et arrivent sur ces niveaux.
- **Exceptions assumées** : Seasons (22px) pour les noms des intervenants sur la page séjour ; Roboto pour le bouton « Continuer avec Google » (charte Google) ; emoji décoratif en 48px sur la page de confirmation de séjour. Rien sous 12px ; 12px est réservé aux libellés, badges et mentions.

## Layout

- Conteneur centré de 1180px max (`--max`), gouttière d'au moins 16px sur mobile.
- Page produit : deux colonnes égales (galerie collante à gauche, informations et onglets à droite), une seule colonne sous 800px.
- Boutique : grille de cartes produit à format portrait 4:5 ; favoris : vignettes carrées.
- Échelle d'espacement : 8 / 26 / 52 / 80 / 110px.

## Elevation & Depth

Très peu d'ombres : la profondeur vient des photos et des fonds. Les fenêtres (visionneuse, « Me prévenir ») utilisent un voile sombre et une ombre douce (`0 20px 40px rgba(0,0,0,.2)`). Le menu utilise un flou d'arrière-plan léger.

## Shapes

Formes presque droites : boutons à angles vifs ou arrondis de 2–3px, champs de formulaire arrondis de 3px. Seuls le bouton favori (rond) et les flèches de la visionneuse sont circulaires.

## Components

- **Bouton d'ajout au panier** : plein `#1e1f22`, texte blanc cassé, capitales espacées ; légère réduction (0,97) à l'appui.
- **Bouton « Me prévenir »** : même forme, avec l'icône cloche SVG (jamais d'emoji).
- **Badges de disponibilité** : en haut à droite de la photo (boutique, favoris) ou à droite du prix (page produit).
- **Bouton favori** : cœur au trait dans un rond blanc, plein et terracotta une fois actif, zone tactile de 44px.
- **Focus clavier** : contour de 2px de la couleur du texte, décalé de 3px (`:focus-visible`).
- **Mouvement** : transitions courtes (150–250ms) en ease-out ; avec « réduire les animations », seuls les fondus sont conservés.

## Do's and Don'ts

- **Do** garder le crème et une seule couleur d'accent.
- **Do** vérifier 4,5:1 pour tout texte, y compris sur le menu et les badges.
- **Do** donner aux boutons tactiles une zone d'au moins 44px.
- **Don't** utiliser le terracotta pour du texte courant.
- **Don't** utiliser des emojis comme icônes.
- **Don't** écrire les couleurs en dur : passer par les variables (`--text`, `--muted`, `--accent`, `--soon`, `--sold-out`).
