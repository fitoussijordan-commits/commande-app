// app/api/odoo/image/route.ts
// Proxy léger pour les images produit Odoo (session cookie requis).
// Résultat mis en cache navigateur 1h.
import { NextRequest, NextResponse } from "next/server";
import { fetchT } from "@/lib/fetchTimeout";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const odooUrl  = searchParams.get("odooUrl");
  const id       = searchParams.get("id");       // product.product ID
  const sessionId = searchParams.get("s");       // session_id (court pour l'URL)

  if (!odooUrl || !id || !sessionId) {
    return new NextResponse(null, { status: 400 });
  }

  const imageUrl = `${odooUrl.replace(/\/$/, "")}/web/image/product.product/${id}/image_128`;

  try {
    const resp = await fetchT(imageUrl, {
      headers: { Cookie: `session_id=${sessionId}` },
    });

    if (!resp.ok) return new NextResponse(null, { status: 404 });

    const buffer = await resp.arrayBuffer();
    const ct = resp.headers.get("content-type") || "image/png";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": ct,
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
