import { supabase } from "./supabaseClient.js";

function fmt(d){
  const [y,m,day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function cardTemplate(stay){
  return `
    <a class="stay-card reveal" href="${stay.href}">
      <div class="img" style="background-image:url('${stay.img}')"></div>

      <div class="veil">
        <div class="dates" data-dates="${stay.eventId}">
          <b>Prochaines dates</b>
          Chargement…
        </div>
      </div>

      <div class="info">
        <div class="dest">${stay.title}</div>
        <div class="meta">${stay.subtitle}</div>
      </div>
    </a>
  `;
}

export async function initStayGrid(){
  const grid = document.getElementById("stayGrid");
  if(!grid) return;

  // ✅ 5 séjours (tu peux ajuster)
  const stays = [
    {
      title:"Séjour en Camargue",
      subtitle:"5 jours · à partir de 970€",
      img:"assets/img/sejour-camargue.jpg",
      href:"sejour-camargue.html",
      eventId:"ee73b110-7d64-4344-821a-6b7980dcff69"
    },
    {
      title:"Voyage à Taghazout",
      subtitle:"5 jours · à partir de 780€",
      img:"assets/img/sejour-taghazout.jpg",
      href:"sejour-taghazout.html",
      eventId:"9617c1f3-269c-475f-9bb3-38ede5ebdd1e"
    },
    {
      title:"Retraite Signature",
      subtitle:"Dates à venir",
      img:"assets/img/stay-3.jpg",
      href:"#",
      eventId:null
    },
    {
      title:"Immersion Nature",
      subtitle:"Dates à venir",
      img:"assets/img/stay-4.jpg",
      href:"#",
      eventId:null
    },
    {
      title:"Échappée Douce",
      subtitle:"Dates à venir",
      img:"assets/img/stay-5.jpg",
      href:"#",
      eventId:null
    }
  ];

  grid.innerHTML = stays.map(cardTemplate).join("");

  // Remplir dates depuis Supabase pour les séjours qui ont un eventId
  const nodes = grid.querySelectorAll("[data-dates]");
  for(const n of nodes){
    const eventId = n.getAttribute("data-dates");
    if(!eventId) {
      n.innerHTML = "<b>Prochaines dates</b>À annoncer";
      continue;
    }

    const { data, error } = await supabase
      .from("events")
      .select("start_date, end_date, place")
      .eq("id", eventId)
      .single();

    if(error || !data){
      n.innerHTML = "<b>Prochaines dates</b>À annoncer";
      continue;
    }

    n.innerHTML = `
      <b>Prochaines dates</b>
      du ${fmt(data.start_date)} au ${fmt(data.end_date)}<br>
      ${data.place || ""}
    `;
  }
}
