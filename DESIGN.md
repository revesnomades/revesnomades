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
typography:
  display:
    fontFamily: "SegoCustom, serif"
    fontWeight: 400
    lineHeight: 1.15
  body:
    fontFamily: "Glacial Indifference, Outfit, Segoe UI, Arial, sans-serif"
    fontWeight: 300
    lineHeight: 1.75
    letterSpacing: "0.01em"
  label:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "11px"
    letterSpacing: "0.12em"
rounded:
  none: "0"
  sm: "2px"
  md: "3px"
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

## Typography

- **Grands titres** : SegoCustom, capitales, poids 400, interlignage serré (1,15). Page produit : 34px (26px sur mobile).
- **Texte courant** : Glacial Indifference 300, interlignage 1,75, léger espacement (0,01em).
- **Libellés de boutons et filtres** : IBM Plex Mono 11–13px, capitales, espacement 0,08–0,12em.
- Les prix utilisent des chiffres tabulaires quand ils sont alignés en colonne.

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
