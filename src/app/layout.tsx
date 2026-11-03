import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Alexsib Blog',
  description: 'Un cuaderno para aprender programación e inteligencia artificial.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
