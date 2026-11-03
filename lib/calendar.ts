// lib/calendar.ts
// RDV d'une journée donnée. Un déplacement (RDV « journée entière » d'Odoo,
// allday) couvre chaque jour de start_date à stop_date ; les autres RDV ne
// comptent que le jour de leur début.
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function eventOnDay(e: any, d: Date): boolean {
  const day = ymd(d);
  if (e?.allday && e.start_date) return e.start_date <= day && day <= (e.stop_date || e.start_date);
  return ymd(new Date(String(e.start).replace(" ", "T") + "Z")) === day;
}

export const ALLDAY_FIELDS = ["allday", "start_date", "stop_date"];

// Client lié au RDV (« document lié » d'Odoo, posé par AppointmentModal).
// res_model peut revenir vide quand Odoo ne garde que res_model_id : un res_id
// seul vient alors forcément de l'app, qui ne lie que des fiches client.
export function linkedPartnerId(e: any): number | null {
  const id = Number(e?.res_id) || 0;
  return id > 0 && (!e?.res_model || e.res_model === "res.partner") ? id : null;
}
