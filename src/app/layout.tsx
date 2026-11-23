import type { Metadata } from 'next';
import './globals.css';
import { AppHeader } from '@/components/AppHeader';
import { PersonaProvider } from '@/context/PersonaContext';

export const metadata: Metadata = {
  title: 'AI-in-the-Loop Planner',
  description:
    'Team meeting notes to task assignment, two-party confirmation, workload conflict checking, and shared calendar sync.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <PersonaProvider>
          <AppHeader />
          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </PersonaProvider>
      </body>
    </html>
  );
}
