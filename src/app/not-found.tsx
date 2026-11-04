import Link from 'next/link';
export default function NotFound() { return <main id="contenido" className="reading center"><p className="eyebrow">~/ruta-desconocida</p><p className="code">404_</p><h1>Por acá no hay ninguna página.</h1><p>Puede que el enlace haya cambiado o que la dirección no esté bien escrita.</p><Link href="/">Volver al inicio →</Link></main>; }
