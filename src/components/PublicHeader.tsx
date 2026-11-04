import Link from 'next/link';
export function PublicHeader() {
  return <header className="site-header"><Link className="brand" href="/">&gt;_ Alexsib Blog</Link><nav aria-label="Navegación principal"><Link href="/#articulos">/artículos</Link><Link href="/sobre-mi">/sobre-mí</Link></nav></header>;
}
