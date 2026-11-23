"""Sert l'app Flow (export statique Next.js, dossier static/app) sous /flow/.

- /flow/          : la page de l'app — utilisateur Odoo connecté obligatoire
                    (sinon redirection vers la connexion Odoo).
- /flow/session   : identité de l'utilisateur connecté, lue par l'app au lancement
                    (remplace l'écran de connexion de la version Vercel).
- /flow/<fichier> : scripts, styles, images de l'app (fichiers statiques).

Les données passent ensuite par le JSON-RPC standard d'Odoo (/web/dataset/call_kw)
avec la session et les droits de l'utilisateur : aucun accès supplémentaire.
"""
import mimetypes
import os

from odoo import http
from odoo.http import request

APP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "app")
BASE = "/flow"

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
}


def _serve(subpath):
    subpath = (subpath or "").lstrip("/")
    full = os.path.normpath(os.path.join(APP_DIR, subpath))
    # Jamais en dehors de static/app (« ../ » refusé).
    if full != APP_DIR and not full.startswith(APP_DIR + os.sep):
        return request.not_found()
    if os.path.isdir(full):
        full = os.path.join(full, "index.html")
    if not os.path.isfile(full):
        return request.not_found()

    ext = os.path.splitext(full)[1].lower()
    ctype = MIME.get(ext) or mimetypes.guess_type(full)[0] or "application/octet-stream"
    headers = [("Content-Type", ctype), ("X-Content-Type-Options", "nosniff")]
    if subpath.startswith("_next/static/"):
        # Fichiers versionnés (nom = empreinte du contenu) : cache long.
        headers.append(("Cache-Control", "public, max-age=31536000, immutable"))
    else:
        headers.append(("Cache-Control", "no-cache"))
    if subpath == "sw.js":
        headers.append(("Service-Worker-Allowed", BASE + "/"))

    with open(full, "rb") as f:
        data = f.read()
    return request.make_response(data, headers=headers)


class FlowApp(http.Controller):

    @http.route([BASE, BASE + "/"], type="http", auth="user", methods=["GET"], sitemap=False)
    def flow_index(self, **kw):
        if not request.httprequest.path.endswith("/"):
            return request.redirect(BASE + "/", local=True)
        return _serve("index.html")

    @http.route(BASE + "/session", type="http", auth="user", methods=["GET"], sitemap=False)
    def flow_session(self, **kw):
        user = request.env.user
        return request.make_json_response(
            {
                "uid": user.id,
                "name": user.name,
                "login": user.login,
                "db": request.db,
                # Utilisé uniquement pour les routes Vercel (assistant, import de bons,
                # export périmés), qui appellent Odoo au nom de l'utilisateur.
                "sid": request.session.sid,
            },
            headers=[("Cache-Control", "no-store")],
        )

    @http.route(BASE + "/<path:subpath>", type="http", auth="none", methods=["GET"], sitemap=False)
    def flow_file(self, subpath, **kw):
        return _serve(subpath)
