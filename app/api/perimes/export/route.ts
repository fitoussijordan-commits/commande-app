// app/api/perimes/export/route.ts
// Export Excel du rapport des périmés (tous clients).
//
// Les données sont lues AVEC LA SESSION DU COMMERCIAL : il n'exporte que ce que
// ses droits Odoo lui laissent voir. Le fichier est soit renvoyé au navigateur
// (PC), soit envoyé par mail à l'adresse de SON compte Odoo (iPad : l'app ne
// sait pas enregistrer un fichier). Le destinataire n'est jamais choisi par
// l'appelant.

import { NextRequest, NextResponse } from "next/server";
import { fetchT } from "@/lib/fetchTimeout";
import { checkRateLimit } from "@/lib/rateLimiter";
import { withCors, preflight } from "@/lib/cors";
import { loadPerimesReport } from "@/lib/perimesReport";
import { buildPerimesWorkbook } from "@/lib/perimesExcel";

export async function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

export const maxDuration = 60;

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function requireHttpUrl(raw: string): string {
  let u: URL;
  try { u = new URL(String(raw || "").trim()); }
  catch { throw new Error(`URL Odoo invalide (« ${raw} »)`); }
  if (!u.hostname || !/^https?:$/.test(u.protocol)) throw new Error(`URL Odoo invalide (« ${raw} »)`);
  return u.origin;
}

async function rpc(base: string, sessionId: string, path: string, params: any) {
  const res = await fetchT(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `session_id=${sessionId}` },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", id: Date.now(), params }),
  }, 25_000);
  const data = await res.json();
  if (data.error) throw new Error(data.error?.data?.message || data.error?.message || "Erreur Odoo");
  return data.result;
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const J = (b: any, init?: ResponseInit) => withCors(NextResponse.json(b, init), origin);

  try {
    const { odooUrl, sessionId, from, to, deliver } = await req.json();
    if (!odooUrl || !sessionId) return J({ error: "odooUrl et sessionId requis" }, { status: 400 });
    if ((from && !DAY.test(from)) || (to && !DAY.test(to))) return J({ error: "Dates invalides" }, { status: 400 });
    const base = requireHttpUrl(odooUrl);

    // Commercial authentifié (le dépôt est public : pas d'accès anonyme).
    const info = await rpc(base, sessionId, "/web/session/get_session_info", {}).catch(() => null);
    const uid = info?.uid;
    if (!uid) return J({ error: "Session Odoo invalide" }, { status: 401 });
    if (!checkRateLimit(`perimes-export:${uid}`, 20, 3600_000).allowed) {
      return J({ error: "Limite atteinte (20 exports par heure)" }, { status: 429 });
    }

    const call = (model: string, method: string, args: any[], kwargs: any = {}) =>
      rpc(base, sessionId, "/web/dataset/call_kw", { model, method, args, kwargs });
    const report = await loadPerimesReport(
      (model, domain, fields, limit = 0, order = "") =>
        call(model, "search_read", [domain], { fields, limit, order, context: { lang: "fr_FR" } }),
      { from, to });

    const author = String(info?.name || info?.username || "");
    const buf = await buildPerimesWorkbook(report, { odooBase: base, from, to, author });
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `Reprises perimes ${from || "debut"} au ${to || stamp}.xlsx`;
    const base64 = buf.toString("base64");

    if (deliver !== "mail") return J({ filename, base64, rows: report.lines.length });

    // Envoi par mail à l'adresse du compte connecté.
    const users = await call("res.users", "read", [[uid], ["email", "login"]]);
    const dest = users?.[0]?.email || users?.[0]?.login;
    if (!dest || !/@/.test(dest)) return J({ error: "Aucune adresse mail sur ton compte Odoo" }, { status: 400 });
    const attId = await call("ir.attachment", "create", [{ name: filename, datas: base64, mimetype: XLSX_MIME }]);
    const mailId = await call("mail.mail", "create", [{
      subject: `Reprises de périmés — ${filename.replace(/\.xlsx$/, "")}`,
      email_to: dest,
      body_html: `<p>Rapport des reprises de périmés généré depuis l'application Commande.</p>`
        + `<p><b>${report.totals.count}</b> reprises · <b>${report.totals.clients}</b> clients</p>`,
      attachment_ids: [[6, 0, [attId]]],
    }]);
    await call("mail.mail", "send", [[mailId]]);
    return J({ filename, sentTo: dest, rows: report.lines.length });
  } catch (e: any) {
    return J({ error: e?.message || "Export impossible" }, { status: 500 });
  }
}
