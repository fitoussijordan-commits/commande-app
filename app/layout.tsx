import "./globals.css";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
