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
