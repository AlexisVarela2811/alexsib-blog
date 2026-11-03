export default function Home() {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6">
      <header className="flex items-center justify-between border-b border-[#304537] py-6 font-mono text-sm">
        <span className="font-bold text-[#a1efb5]">~/ Alexsib Blog</span>
        <nav aria-label="Navegación principal">
          <a href="#articulos">Artículos</a>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 py-20 sm:py-28">
        <p className="mb-5 font-mono text-sm text-[#a1efb5]">{'// un cuaderno de aprendizaje'}</p>
        <h1 className="font-serif text-5xl leading-tight sm:text-6xl">Aprender explicando.</h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-[#a6b9ac]">
          Ideas sobre programación e inteligencia artificial, explicadas paso a paso.
        </p>
        <section id="articulos" className="mt-24 border-t border-[#304537] pt-8" aria-labelledby="articles-heading">
          <h2 id="articles-heading" className="font-mono text-sm text-[#a1efb5]">01 / Artículos</h2>
          <p className="mt-6 text-[#a6b9ac]">Aún no hay artículos publicados.</p>
        </section>
      </main>
      <footer className="border-t border-[#304537] py-6 font-mono text-xs text-[#a6b9ac]">
        Alexsib Blog · Un cuaderno para aprender
      </footer>
    </div>
  );
}
