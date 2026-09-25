import type { Metadata } from 'next';
import { Geist, Geist_Mono, Noto_Sans_Devanagari, Mukta } from 'next/font/google';
import './globals.css';
import { Sidebar } from '@/components/shell/Sidebar';
import { ClientShellLoader } from '@/components/shell/ClientShellLoader';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
const notoDevanagari = Noto_Sans_Devanagari({
  variable: '--font-noto-devanagari',
  subsets: ['devanagari', 'latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
});
const mukta = Mukta({
  variable: '--font-mukta',
  subsets: ['devanagari', 'latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SWAY',
  description: 'Premium Music Experience',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${notoDevanagari.variable} ${mukta.variable}`}
    >
      <body className="flex h-screen overflow-hidden bg-[--surface] text-[--foreground]">
        <Sidebar />
        {/* Main scroll area: pb-[136px] mobile (player 80 + nav 56), pb-[80px] md+ */}
        <main className="flex-1 overflow-y-auto pb-[136px] md:pb-[80px]">{children}</main>
        {/* All client-only overlays: player, lyrics, queue, search, mobile nav */}
        <ClientShellLoader />
      </body>
    </html>
  );
}
