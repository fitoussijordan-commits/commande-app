export const metadata = {
  title: "Prise de commande",
  description: "Outil de prise de commande — connexion directe Odoo",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
