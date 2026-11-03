import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Central Operacional | Grupo Pomar",
  description: "Sistema interno de direção e operação.",
  icons: {
    apple: [
      {
        url: "/brand/pomar-metal-180.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
