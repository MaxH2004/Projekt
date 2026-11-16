import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Property Management" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
