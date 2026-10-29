// lib/delivery.ts
// Date d'expédition prévue d'une commande transmise directement à la logistique.
//
//   • Saisie un jour ouvré AVANT 14 h 30 → expédiée le jour même, livrée J+1.
//   • Saisie APRÈS 14 h 30               → expédiée le jour ouvré suivant, livrée J+2.
//   • Saisie un samedi, un dimanche ou un jour férié → comme le premier jour ouvré
//     suivant AVANT 14 h 30.
//   • Jours ouvrés : lundi → vendredi, hors jours fériés français.
//   • Client fermé certains jours (étiquette « Fermé le lundi »…) : la livraison
//     passe au jour ouvré suivant où il est ouvert, et l'expédition se cale la veille.
//
// Heure de l'appareil (France). Pure : testable sans Odoo.

const CUTOFF_MINUTES = 14 * 60 + 30;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Dimanche de Pâques (algorithme de Meeus / Jones / Butcher).
function easter(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const _holidays = new Map<number, Set<string>>();
export function frenchHolidays(year: number): Set<string> {
  if (!_holidays.has(year)) {
    const e = easter(year);
    _holidays.set(year, new Set([
      `${year}-01-01`, `${year}-05-01`, `${year}-05-08`, `${year}-07-14`,
      `${year}-08-15`, `${year}-11-01`, `${year}-11-11`, `${year}-12-25`,
      key(addDays(e, 1)),    // lundi de Pâques
      key(addDays(e, 39)),   // Ascension
      key(addDays(e, 50)),   // lundi de Pentecôte
    ]));
  }
  return _holidays.get(year)!;
}

export function isWorkingDay(d: Date): boolean {
  const wd = d.getDay();
  return wd !== 0 && wd !== 6 && !frenchHolidays(d.getFullYear()).has(key(d));
}
const nextWorkingDay = (d: Date) => { let x = addDays(d, 1); while (!isWorkingDay(x)) x = addDays(x, 1); return x; };
const prevWorkingDay = (d: Date) => { let x = addDays(d, -1); while (!isWorkingDay(x)) x = addDays(x, -1); return x; };

export interface ShippingPlan { expedition: Date; delivery: Date }

// closedWeekdays : jours de fermeture du client, au format Date.getDay() (1 = lundi).
export function planShipping(now: Date, closedWeekdays: number[] = []): ShippingPlan {
  const today = startOfDay(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const ship = !isWorkingDay(today) ? nextWorkingDay(today)
    : minutes >= CUTOFF_MINUTES ? nextWorkingDay(today)
    : today;
  let delivery = nextWorkingDay(ship);
  for (let i = 0; i < 14 && closedWeekdays.includes(delivery.getDay()); i++) delivery = nextWorkingDay(delivery);
  // Expédiée la veille de la livraison (jamais avant le jour d'expédition possible).
  const before = prevWorkingDay(delivery);
  return { expedition: before > ship ? before : ship, delivery };
}

export const toOdooDate = key;

// Délégués dont les commandes partent DIRECTEMENT à la logistique (étiquette
// « Transmise » + date d'expédition prévue). Phase de test : Jordan seul.
const DIRECT_LOGISTICS_USERS = [/jordan\s+fitoussi/i];
export function isDirectLogistics(session: { name?: string; login?: string }): boolean {
  return DIRECT_LOGISTICS_USERS.some(re => re.test(session.name || "") || re.test(session.login || ""));
}
