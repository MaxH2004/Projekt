import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Hausverwaltung" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
