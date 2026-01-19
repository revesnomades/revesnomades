import {
  getUpcomingEvents,
  getNextEventForStay,
  getMissingForEvent,
  subscribeNewsletter,
  sendMessage
} from "./supabaseApi.js";

function fmtDateRange(start, end){
  if(!start || !end) return "";
  return `${start} → ${end}`;
}

export async function initIndex(){
  // On remplit les 2 séjours affichés sur la home
  const blocks = document.querySelectorAll("[data-stay]");
  if(!blocks.length) return;

  const events = await getUpcomingEvents();
  const byStay = new Map();
  for(const ev of events){
    if(!byStay.has(ev.stay_id)) byStay.set(ev.stay_id, ev);
  }

  for(const b of blocks){
    const stayId = b.getAttribute("data-stay");
    const dateEl = b.querySelector("[data-date]");
    const placeEl = b.querySelector("[data-place]");
    const missingEl = b.querySelector("[data-missing]");
    const bookBtn = b.querySelector("[data-book]");

    const ev = byStay.get(stayId);
    if(!ev){
      dateEl.textContent = "Dates à venir : bientôt";
      placeEl.textContent = "Lieu : à annoncer";
      missingEl.textContent = "";
      continue;
    }

    dateEl.textContent = `Dates : ${fmtDateRange(ev.start_date, ev.end_date)}`;
    placeEl.textContent = `Lieu : ${ev.place || "À annoncer"}`;

    const missing = await getMissingForEvent(ev.id);
    missingEl.textContent = missing > 0
      ? `Il manque ${missing} réservation(s) pour valider ce séjour (minimum 10).`
      : `Séjour validé ✅`;

    if(bookBtn){
      // bouton vers la page séjour
      bookBtn.href = stayId === "4j3n" ? "sejour-4j.html" :
                     stayId === "5j4n" ? "sejour-5j.html" :
                     "sejour-3j.html";
    }
  }
}

export async function initStayPage(stayId){
  // Sur les pages séjour : le bouton Réserver mène au panier (pas de réservation directe ici)
  const info = document.getElementById("stayEventInfo");
  const missingEl = document.getElementById("stayMissing");
  const btn = document.getElementById("stayBookBtn");

  const ev = await getNextEventForStay(stayId);
  if(!ev){
    info.textContent = "Aucune date à venir pour le moment.";
    missingEl.textContent = "";
    btn.disabled = true;
    return;
  }

  info.textContent = `${ev.title || "Séjour"} · ${fmtDateRange(ev.start_date, ev.end_date)} · ${ev.place || "À annoncer"}`;

  const missing = await getMissingForEvent(ev.id);
  missingEl.textContent = missing > 0
    ? `Il manque ${missing} réservation(s) pour valider ce séjour (minimum 10).`
    : `Séjour validé ✅`;

  btn.addEventListener("click", ()=>{
    // Autorise l'accès au panier uniquement depuis ici
    sessionStorage.setItem("allowCart", "1");

    // On passe les infos au panier
    const params = new URLSearchParams({
      stayId,
      eventId: ev.id
    });
    window.location.href = `panier.html?${params.toString()}`;
  });
}

export function initForms(){
  const nForm = document.getElementById("newsletterForm");
  if(nForm){
    nForm.addEventListener("submit", async (e)=>{
      e.preventDefault();
      const name = nForm.querySelector("[name=name]").value.trim();
      const email = nForm.querySelector("[name=email]").value.trim();
      const msg = document.getElementById("newsletterMsg");
      msg.textContent = "";
      try{
        await subscribeNewsletter(name, email);
        msg.textContent = "Merci ✨ Vous êtes bien inscrit(e).";
        nForm.reset();
      }catch(err){
        msg.textContent = err.message || "Erreur newsletter";
      }
    });
  }

  const cForm = document.getElementById("contactForm");
  if(cForm){
    cForm.addEventListener("submit", async (e)=>{
      e.preventDefault();
      const subject = cForm.querySelector("[name=subject]").value;
      const name = cForm.querySelector("[name=name]").value.trim();
      const email = cForm.querySelector("[name=email]").value.trim();
      const message = cForm.querySelector("[name=message]").value.trim();
      const msg = document.getElementById("contactMsg");
      msg.textContent = "";
      try{
        await sendMessage(subject, name, email, message);
        msg.textContent = "Message envoyé ✅ Nous vous répondons vite.";
        cForm.reset();
      }catch(err){
        msg.textContent = err.message || "Erreur contact";
      }
    });
  }
}
