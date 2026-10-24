import type { Metadata } from 'next';
import Link from 'next/link';
import { Courier_Prime, Public_Sans, Spectral } from 'next/font/google';
import './globals.css';

const display = Spectral({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-display' });
const body = Public_Sans({ subsets: ['latin'], variable: '--font-body' });
const mono = Courier_Prime({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Mandat',
  description: 'Spending mandates for AI shopping agents on PayPal, with sealed receipts that merchants can use as dispute evidence.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <header className="masthead">
          <div className="shell">
            <Link href="/" className="wordmark">Mandat<span>.</span></Link>
            <nav aria-label="Main">
              <Link href="/">New mandate</Link>
              <Link href="/verify">Verify a receipt</Link>
            </nav>
            <span className="sandbox-tag">PayPal sandbox · no real money</span>
          </div>
        </header>
        <main className="shell">{children}</main>
        <footer className="footer">
          <div className="shell">Open source (MIT) · built for the PayPal AI Hackathon · <a href="https://github.com/FredBourouliou/mandat">source code</a></div>
        </footer>
      </body>
    </html>
  );
}
