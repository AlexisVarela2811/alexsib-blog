import type { Metadata } from 'next';
import { PublicHeader } from '../components/PublicHeader';
import { PublicFooter } from '../components/PublicFooter';
import './globals.css';
export const metadata: Metadata = { title: { default: 'Alexsib Blog', template: '%s · Alexsib Blog' }, description: 'Un cuaderno para aprender programación e inteligencia artificial.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body><a className="skip" href="#contenido">Saltar al contenido</a><div className="wrap"><PublicHeader />{children}<PublicFooter /></div></body></html>;
}
