import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'OpenContact — Public Email Finder', description: 'Discover publicly published professional and business contact emails.' };
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) { return <html lang="en"><body>{children}</body></html>; }
