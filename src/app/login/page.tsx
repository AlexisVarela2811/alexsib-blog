export default function LoginPage() {
  return (
    <main>
      <h1>Acceso privado</h1>
      <p>El acceso todavía no está disponible.</p>
      <form method="post">
        <label htmlFor="username">Usuario</label>
        <input id="username" name="username" autoComplete="username" disabled />
        <label htmlFor="password">Contraseña</label>
        <input id="password" name="password" type="password" autoComplete="current-password" disabled />
        <button type="submit" disabled>Ingresar</button>
      </form>
    </main>
  );
}
