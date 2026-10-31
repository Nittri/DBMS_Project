import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Forex Desk",
  description: "A learning project for forex trading and relational database systems.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
