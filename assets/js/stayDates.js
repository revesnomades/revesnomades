import { supabase } from "./supabaseClient.js";

/** Capitalise juste la 1ère lettre (Mars au lieu de mars) */
function capFirst(str=""){
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
}

function formatFRDate(dateStr){
  // dateStr attendu: YYYY-MM-DD
  const d = new Date(dateStr + "T00:00:00");
  const day = new Intl.DateTimeFormat("fr-FR", { day: "numeric" }).format(d);
  const month = capFirst(new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(d));
  const year = new Intl.DateTimeFormat("fr-FR", { year: "numeric" }).format(d);
  return { day, month, year, d };
}

function formatRangeFR(startStr, endStr){
  if(!startStr || !endStr) return "Dates à annoncer";

  const s = formatFRDate(startStr);
  const e = formatFRDate(endStr);

  // Même mois + même année => "du 13 au 17 Mars 2026"
  if(s.month === e.month && s.year === e.year){
    return `du ${s.day} au ${e.day} ${s.month} ${s.year}`;
  }

  // Sinon => "du 28 Avril 2026 au 2 Mai 2026"
  return `du ${s.day} ${s.month} ${s.year} au ${e.day} ${e.month} ${e.year}`;
}

/** Récupère le prochain event pour un stay_id */
async function getNextEvent(stayId){
  const today = new Date().toISOString().slice(0,10);

  const { data, error } = await supabase
    .from("events")
    .select("start_date,end_date,place")
    .eq("stay_id", stayId)
    .gte("start_date", today)
    .order("start_date", { ascending: true })
    .limit(1);

  if(error) throw error;
  return data?.[0] || null;
}

/** INDEX: remplit tous les éléments qui ont data-stay-id */
export async function hydrateIndexDates(){
  const nodes = document.querySelectorAll("[data-stay-id][data-dates-target]");
  if(!nodes.length) return;

  // cache simple pour éviter 5 requêtes identiques
  const cache = new Map();

  for(const el of nodes){
    const stayId = el.getAttribute("data-stay-id");
    if(!stayId) continue;

    try{
      if(!cache.has(stayId)){
        cache.set(stayId, await getNextEvent(stayId));
      }
      const ev = cache.get(stayId);
      el.textContent = ev ? formatRangeFR(ev.start_date, ev.end_date) : "Dates à annoncer";
    }catch(_e){
      el.textContent = "Dates à annoncer";
    }
  }
}

/** PAGE SÉJOUR: remplit #stayDates avec le stayId */
export async function hydrateStayPageDate(stayId, datesElId="stayDates"){
  const el = document.getElementById(datesElId);
  if(!el) return;

  try{
    const ev = await getNextEvent(stayId);
    el.textContent = ev ? formatRangeFR(ev.start_date, ev.end_date) : "Dates à annoncer";
  }catch(_e){
    el.textContent = "Dates à annoncer";
  }
}
