// app/api/odoo/proxy/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fetchT } from "@/lib/fetchTimeout";
import { checkRateLimit, getClientIp } from "@/lib/rateLimiter";

// Allowlist des endpoints Odoo autorisés — bloque toute tentative SSRF
const ALLOWED_ENDPOINTS = [
  "/web/session/authenticate",
  "/web/session/destroy",
  "/web/dataset/call_kw",
];

function isEndpointAllowed(endpoint: string): boolean {
  return ALLOWED_ENDPOINTS.some(allowed => endpoint.startsWith(allowed));
}

export async function POST(req: NextRequest) {
  // ── Rate limiting : 300 req / 60s par IP ──
  const ip = getClientIp(req);
  const rl = checkRateLimit(`proxy:${ip}`, 300, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Trop de requêtes" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetIn / 1000)) } }
    );
  }

  try {
    const body = await req.json();
    const { odooUrl, endpoint, params, sessionId } = body;

    // ── Ping de connectivité (utilisé par lib/network.ts) ──
    // Répond immédiatement sans contacter Odoo : sert uniquement à prouver
    // que le réseau/serveur est joignable côté client.
    if (body.ping === true) {
      return NextResponse.json({ pong: true });
    }

    if (!odooUrl || !endpoint) {
      return NextResponse.json({ error: "odooUrl et endpoint requis" }, { status: 400 });
    }

    // ── Protection SSRF : l'URL doit correspondre exactement à ODOO_URL ──────
    const allowedBase = (process.env.ODOO_URL || "").replace(/\/$/, "").toLowerCase();
    const requestedBase = odooUrl.replace(/\/$/, "").toLowerCase();

    if (allowedBase && requestedBase !== allowedBase) {
      console.warn(`[proxy] SSRF bloqué — URL non autorisée: ${odooUrl}`);
      return NextResponse.json({ error: "URL Odoo non autorisée" }, { status: 403 });
    }

    // Bloquer les IPs privées et metadata cloud même si ODOO_URL n'est pas défini
    const BLOCKED_PATTERNS = [
      /^https?:\/\/169\.254\./,
      /^https?:\/\/metadata\.google/,
      /^https?:\/\/10\./,
      /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,
      /^https?:\/\/192\.168\./,
      /^https?:\/\/127\./,
      /^https?:\/\/0\./,
      /^https?:\/\/localhost/i,
    ];
    if (BLOCKED_PATTERNS.some(p => p.test(odooUrl))) {
      console.warn(`[proxy] SSRF bloqué — IP réservée: ${odooUrl}`);
      return NextResponse.json({ error: "URL non autorisée" }, { status: 403 });
    }

    if (!isEndpointAllowed(endpoint)) {
      console.warn(`[proxy] Endpoint non autorisé: ${endpoint}`);
      return NextResponse.json({ error: "Endpoint non autorisé" }, { status: 403 });
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (sessionId) headers["Cookie"] = `session_id=${sessionId}`;

    const url = `${odooUrl.replace(/\/$/, "")}${endpoint}`;

    const odooRes = await fetchT(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", method: "call", id: Date.now(), params }),
    }, 15_000);

    const setCookies = odooRes.headers.getSetCookie?.() || [];
    let newSessionId = null;
    for (const cookie of setCookies) {
      const match = cookie.match(/session_id=([^;]+)/);
      if (match) { newSessionId = match[1]; break; }
    }
    if (!newSessionId) {
      const cookieHeader = odooRes.headers.get("set-cookie");
      if (cookieHeader) {
        const match = cookieHeader.match(/session_id=([^;]+)/);
        if (match) newSessionId = match[1];
      }
    }

    const data = await odooRes.json();

    if (data.error) {
      const msg = data.error.data?.message || data.error.message || JSON.stringify(data.error);
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    if (endpoint === "/web/session/authenticate" && data.result) {
      if (newSessionId) data.result.session_id = newSessionId;
      if (!data.result.uid || data.result.uid === false) {
        return NextResponse.json({ error: "Identifiants incorrects" }, { status: 401 });
      }
    }

    return NextResponse.json({ result: data.result, sessionId: newSessionId });
  } catch (e: any) {
    console.error("Proxy Odoo error:", e);
    return NextResponse.json(
      { error: "Erreur de connexion au serveur Odoo" },
      { status: 500 }
    );
  }
}
