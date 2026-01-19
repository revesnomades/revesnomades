// assets/js/stay-stripe.js
(() => {
  // On lit les infos du séjour depuis <body data-stay="camargue" ...>
  const stayKey = document.body.dataset.stay;
  const basePrice = Number(document.body.dataset.basePrice || 0);
  const singleExtra = Number(document.body.dataset.singleExtra || 120);

  // ✅ Mets ici TES Payment Links (2 liens par séjour)
  // 1 lien chambre partagée, 1 lien chambre individuelle
  const STRIPE = {
    camargue: {
      double_partagee: "https://buy.stripe.com/test_7sY7sF4GJaogdc11oM0ZW06",
      individuelle:     "https://buy.stripe.com/test_28EbIVgprcwoc7X0kI0ZW09"
    },
    taghazout: {
      double_partagee: "https://buy.stripe.com/test_3cI5kx3CFgME4Fv1oM0ZW01",
      individuelle:     "https://buy.stripe.com/test_9B6cMZ6ORgME3Breby0ZW0a"
    }
  };

  const roomType = document.getElementById("roomType");
  const qtyMinus = document.getElementById("qtyMinus");
  const qtyPlus  = document.getElementById("qtyPlus");
  const qtyValue = document.getElementById("qtyValue");
  const totalPrice = document.getElementById("totalPrice");
  const btnStripe = document.getElementById("btnStripe");
  const bookingMsg = document.getElementById("bookingMsg");

  if (!stayKey || !basePrice || !roomType || !btnStripe) return;

  let qty = 1;

  const priceFor = () => {
    const extra = roomType.value === "individuelle" ? singleExtra : 0;
    return (basePrice + extra) * qty;
  };

  const render = () => {
    qtyValue.textContent = String(qty);
    totalPrice.textContent = `${priceFor().toFixed(0)} €`;
  };

  qtyMinus.addEventListener("click", () => {
    qty = Math.max(1, qty - 1);
    render();
  });

  qtyPlus.addEventListener("click", () => {
    qty = Math.min(10, qty + 1);
    render();
  });

  roomType.addEventListener("change", render);

  btnStripe.addEventListener("click", () => {
    bookingMsg.textContent = "";

    const link = STRIPE?.[stayKey]?.[roomType.value];
    if (!link) {
      bookingMsg.textContent = "Lien Stripe manquant pour ce type de chambre.";
      return;
    }

    // ✅ IMPORTANT :
    // Avec Payment Links, la quantité se gère côté Stripe (le client choisit sur Stripe).
    // Ici on ne peut pas forcer la quantité par URL de manière fiable.
    // On peut toutefois pré-remplir des infos en query params (non garanti côté Stripe).
    const u = new URL(link);
    u.searchParams.set("rn_stay", stayKey);
    u.searchParams.set("rn_room", roomType.value);
    u.searchParams.set("rn_qty", String(qty));

    window.location.href = u.toString();
  });

  render();
})();
