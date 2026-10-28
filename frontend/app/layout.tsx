import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { HapticsProvider } from "@/components/layout/haptics-provider";
import { AuthProvider } from "@/providers/AuthProvider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "GradeBook",
  description: "School management platform",
  authors: [{ name: "daulric.dev", url: "https://daulric.dev" }],
  creator: "daulric.dev",
};

export default async function RootLayout({children}: {children: React.ReactNode}) {
  // The per-request CSP nonce from proxy.ts (production only). Reading headers
  // renders every page per request, which a nonce requires: a prerendered page
  // would carry no nonce and its scripts would be blocked.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          nonce={nonce}
        >
          <TooltipProvider delay={0}>
            <HapticsProvider />
            <AuthProvider>{children}</AuthProvider>
            <Toaster richColors position="top-right" />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
