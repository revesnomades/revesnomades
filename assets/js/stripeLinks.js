// assets/js/stripeLinks.js

export const STRIPE_STAYS = {
  // stayId (supabase) : payment links (Stripe)
  "5j4n": {
    // Camargue (970€ / pers)
    default: "https://buy.stripe.com/test_7sY7sF4GJaogdc11oM0ZW06"
  },
  "4j3n": {
    // Taghazout (780€ / pers)
    default: "https://buy.stripe.com/test_3cI5kx3CFgME4Fv1oM0ZW01"
  }
};

// Cartes cadeaux : montants fixes + lien "custom"
export const STRIPE_GIFTS = {
  50: "https://buy.stripe.com/test_00wdR3ddf6801tjgjG0ZW05",
  100: "https://buy.stripe.com/test_cNi00d3CFaog5Jz8Re0ZW04",
  150: "https://buy.stripe.com/test_9B67sF8WZ9kcb3T2sQ0ZW03",
  200: "https://buy.stripe.com/test_8x26oB5KNcwo1tj3wU0ZW02",
  custom: "https://buy.stripe.com/test_5kQeV7flneEw7RH6J60ZW07"
};
