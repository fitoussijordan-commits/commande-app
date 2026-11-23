import "./globals.css";
import { asset } from "@/lib/appTarget";

// Icône (onglet, écran d'accueil iPad / PWA) : celle de l'app iOS.
export const metadata = {
  title: "Flow",
  description: "Outil de prise de commande — connexion directe Odoo",
  manifest: asset("/manifest.webmanifest"),
  icons: {
    icon: [{ url: asset("/icons/favicon-32.png"), sizes: "32x32" }, { url: asset("/icons/icon-192.png"), sizes: "192x192" }],
    apple: asset("/icons/apple-touch-icon.png"),
  },
  appleWebApp: { capable: true, title: "Flow", statusBarStyle: "default" as const },
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
