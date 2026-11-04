import Link from 'next/link';
import { getPublishedArticles } from '../lib/articles';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const articles = await getPublishedArticles();
  return <main id="contenido"><section className="hero"><div><p className="eyebrow">~/alexsib/cuaderno</p><h1>Aprender explicando.</h1><p>Ideas sobre programación e inteligencia artificial, explicadas paso a paso.</p><a href="#articulos">Explorar el cuaderno ↓</a></div><div className="terminal"><p>~ $ cat sobre-mi.md</p><p>Hola, soy Alexsib.<br />Escribo para entender mejor lo que voy aprendiendo.</p><p>Este es mi cuaderno abierto: código, IA y buenas preguntas.</p></div></section><section id="articulos" className="listing"><h2>Ideas para explorar</h2><p>Explicaciones para empezar, sin saber de antemano.</p>{articles.length === 0 ? <p>Aún no hay artículos publicados.</p> : articles.map(article => <article className="post" key={article.id}><p className="eyebrow">{article.tags.join(' / ')}</p><h3><Link href={`/articulo/${encodeURIComponent(article.slug)}`}>{article.title}</Link></h3><p>{article.excerpt}</p></article>)}</section></main>;
}
