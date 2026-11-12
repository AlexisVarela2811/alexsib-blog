import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Acceso privado', robots: { index: false, follow: false } };

export default function LoginPage() {
  return (
    <main id="contenido">
      <section className="auth" aria-labelledby="acceso">
        <p className="eyebrow">~/panel/acceso</p>
        <h1 id="acceso">Volver al cuaderno.</h1>
        <p>El espacio privado para escribir y cuidar tus artículos.</p>
        <form action="/api/auth/login" method="post">
          <label htmlFor="username">Usuario</label>
          <input id="username" name="username" autoComplete="username" required />
          <label htmlFor="password">Contraseña</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          <button type="submit">Ingresar</button>
        </form>
        <p className="hint">Si el ingreso falla, probá de nuevo en unos minutos.</p>
        <Link href="/">← Volver al blog</Link>
      </section>
    </main>
  );
}
