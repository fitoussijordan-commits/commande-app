export const metadata = {
  title: "Prise de commande",
  description: "Outil de prise de commande — connexion directe Odoo",
};

// viewport-fit=cover : indispensable en natif iOS pour que les safe-area-inset
// soient exposés (sinon la barre de statut de l'iPad chevauche le contenu).
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover" as const,
};

// CSS safe-area injecté via une balise <style> dans le <body> (dangerouslySet).
// On évite : (1) un fichier .css → pas de pipeline PostCSS dans ce projet ;
// (2) un <head> manuel → cassait l'hydratation en App Router.
const GLOBAL_CSS = `
  html, body { margin: 0; }
  body {
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
    box-sizing: border-box;
    background: #f8fafc;
  }
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body style={{ margin: 0 }}>
        <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
        {children}
      </body>
    </html>
  );
}
