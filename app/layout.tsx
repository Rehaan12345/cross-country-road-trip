import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { ReadOnlyProvider } from "@/components/ReadOnly";
import { roleOf } from "@/lib/role";
import "./globals.css";

export const metadata: Metadata = {
  title: "Drive 26",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0d0f12",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Reading the cookie here makes every page dynamic. That is the correct
  // trade: the alternative is a client-side role check, which means shipping
  // markup that is wrong until it hydrates.
  const role = roleOf((await cookies()).get("auth")?.value);

  return (
    <html lang="en">
      <body>
        <ReadOnlyProvider value={role === "view"}>{children}</ReadOnlyProvider>
      </body>
    </html>
  );
}
