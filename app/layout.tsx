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
      <head>
        <style>{`
          :root { --sat: env(safe-area-inset-top); --sab: env(safe-area-inset-bottom); }
          html, body { margin: 0; }
          /* Réserve la barre de statut iOS en haut et l'indicateur home en bas */
          body {
            padding-top: env(safe-area-inset-top);
            padding-bottom: env(safe-area-inset-bottom);
            padding-left: env(safe-area-inset-left);
            padding-right: env(safe-area-inset-right);
            box-sizing: border-box;
            background: #f8fafc;
          }
        `}</style>
      </head>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
