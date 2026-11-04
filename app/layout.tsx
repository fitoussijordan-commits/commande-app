import "./globals.css";

// Icône (onglet, écran d'accueil iPad / PWA) : celle de l'app iOS.
export const metadata = {
  title: "Prise de commande",
  description: "Outil de prise de commande — connexion directe Odoo",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32" }, { url: "/icons/icon-192.png", sizes: "192x192" }],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, title: "Commande", statusBarStyle: "default" as const },
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
      <body>{children}</body>
    </html>
  );
}
