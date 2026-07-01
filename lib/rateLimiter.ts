/**
 * Rate limiter en mémoire — suffisant pour Vercel serverless (instance unique par région).
 * Pour une protection multi-instance, utiliser Vercel KV / Redis.
 *
 * Usage :
 *   const ok = checkRateLimit(ip, 20, 60_000); // 20 req / 60s par IP
 *   if (!ok) return NextResponse.json({ error: "Trop de requêtes" }, { status: 429 });
 */

interface Bucket { count: number; resetAt: number; }
const store = new Map<string, Bucket>();

// Nettoyage automatique toutes les 5 minutes (évite les fuites mémoire)
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    store.forEach((bucket, key) => {
      if (now > bucket.resetAt) store.delete(key);
    });
  }, 5 * 60 * 1000);
}

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const bucket = store.get(key);

  if (!bucket || now > bucket.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetIn: windowMs };
  }

  if (bucket.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetIn: bucket.resetAt - now };
  }

  bucket.count++;
  return { allowed: true, remaining: maxRequests - bucket.count, resetIn: bucket.resetAt - now };
}

export function getClientIp(req: Request): string {
  const xff = (req.headers as any).get?.("x-forwarded-for") || "";
  return xff.split(",")[0].trim() || "unknown";
}
