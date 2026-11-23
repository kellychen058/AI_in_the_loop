import type { Metadata } from 'next';
import './globals.css';
import { AppHeader } from '@/components/AppHeader';
import { PersonaProvider } from '@/context/PersonaContext';

export const metadata: Metadata = {
  title: 'The Living Handshake — AI-in-the-Loop Planner',
  description:
    'AI drafts in blueprint; two humans sign in ink; only then does the calendar lock open.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#F7F6F2] text-[#111827]">
        <PersonaProvider>
          <AppHeader />
          <main className="mx-auto max-w-[1380px] px-4 py-5 sm:px-6">{children}</main>
        </PersonaProvider>
      </body>
    </html>
  );
}
