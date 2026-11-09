import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Static HTML snapshots of the four public Angular templates. The browser app
// remains available for interactive routes; public pages do not need JS to read.
const base = 'dist/portfolio-simulator';
const out = existsSync(join(base, 'browser', 'index.html')) ? join(base, 'browser') : base;
const shell = readFileSync(join(out, 'index.html'), 'utf8');
const info = readFileSync('src/app/features/public/public-info.component.ts', 'utf8');
const landing = readFileSync('src/app/features/public/public-landing.component.ts', 'utf8');
const legal = readFileSync('src/app/features/public/public-legal.component.ts', 'utf8');
const template = source => source.match(/template:\s*`([\s\S]*?)`,\s*styles:/)?.[1];
const styles = source => source.match(/styles:\s*\[\s*`([\s\S]*?)`\s*\]/)?.[1];
if (!template(info) || !template(legal) || !template(landing)) throw Error('Public component templates changed; update prerender extractor.');
const routes = {
  'chi-siamo': ['Guida ETF, Monte Carlo e rischio | Razer','Guida pubblica Razer su diversificazione ETF, volatilità, drawdown, simulazioni Monte Carlo, ribilanciamento e trend following.'],
  privacy: ['Informativa privacy | Razer','Informativa sul trattamento dei dati personali e sui diritti degli utenti Razer.'],
  cookies: ['Cookie e preferenze | Razer','Informazioni su cookie, Google Analytics, pubblicità e preferenze di consenso.'],
  contatti: ['Contatti | Razer','Contatti del gestore della piattaforma Razer e richieste relative alla privacy.']
};
function section(source, key) {
  const marker = key === 'privacy' ? "@if(page === 'privacy') {" : key === 'cookies' ? "} @else if(page === 'cookies') {" : "} @else {";
  const start = source.indexOf(marker);
  if (start < 0) throw Error('Missing legal template branch: ' + key);
  let pos = start + marker.length, depth = 1;
  const from = pos;
  while (pos < source.length && depth) {
    if (source[pos] === '{') depth++;
    if (source[pos] === '}') depth--;
    pos++;
  }
  if (depth) throw Error('Unbalanced legal template branch: ' + key);
  return source.slice(from, pos - 1);
}
const rawLegal = template(legal);
const prefix = rawLegal.slice(0, rawLegal.indexOf("@if(page === 'privacy') {"));
const suffix = rawLegal.slice(rawLegal.indexOf('<footer>'));
const headings = {privacy:'Informativa sulla privacy',cookies:'Cookie e preferenze',contatti:'Contatti e titolare'};
function clean(html) {
  return html.replace(/routerLink=/g, 'href=')
    .replace(/\s*\(click\)="[^"]*"/g, '')
    .replace(/\{\{\s*title\s*\}\}/g, '')
    .replace(/\{\{[^}]+\}\}/g, 'Non disponibile nella versione statica');
}
for (const [route, [title, description]] of Object.entries(routes)) {
  let body = route === 'chi-siamo' ? template(info) : prefix + section(rawLegal, route) + suffix;
  body = clean(body).replace('<h1></h1>', '<h1>' + (headings[route] || '') + '</h1>');
  if (route === 'cookies') {
    // The static snapshot is intentionally readable without JS. The interactive
    // cookie preference controls are provided by Angular after navigation.
    body = body.replace(/<div class="actions">[\s\S]*?<\/div>/, '<p>Per modificare le preferenze, apri la <a href="/login">pagina di accesso</a> e usa il comando Preferenze privacy.</p>');
  }
  const css = styles(route === 'chi-siamo' ? info : legal);
  const head = shell.slice(0, shell.indexOf('</head>'))
    .replace(/<title>[\s\S]*?<\/title>/, '<title>' + title + '</title>')
    .replace(/<meta name="description"[^>]*>/, '<meta name="description" content="' + description + '">')
    .replace(/<link rel="canonical"[^>]*>/, '<link rel="canonical" href="https://razeretf.com/' + route + '">');
  // Static pages do not display ads and should not load advertising scripts.
  const staticHead = head.replace(/<script async src="https:[^"]*googlesyndication[^>]*><\/script>/, '');
  const html = staticHead + '<meta name="robots" content="index,follow"><style>' + css + '</style></head><body>' + body + '</body></html>';
  const dir = join(out, route);
  mkdirSync(dir, {recursive:true});
  writeFileSync(join(dir, 'index.html'), html, 'utf8');
  console.log('Prerendered /' + route);
}

// Make the canonical root URL readable to crawlers before Angular bootstraps.
// Preserve the Angular JS bundles so /login and all authenticated SPA routes still work.
const rootHead = shell.replace(/<title>[\\s\\S]*?<\\/title>/, '<title>Razer | Laboratorio ETF, portafogli e simulazioni Monte Carlo</title>')
  .replace(/<meta name="description"[^>]*>/, '<meta name="description" content="Costruisci e confronta portafogli ETF, studia rischio e rendimento con simulazioni Monte Carlo. Prova il tutorial gratuito senza registrazione.">');
const rootHtml = rootHead.replace('<app-root></app-root>', '<app-root>' + clean(template(landing)) + '</app-root>')
  .replace('</head>', '<meta name="robots" content="index,follow"><style>' + styles(landing) + '</style></head>');
writeFileSync(join(out, 'index.html'), rootHtml, 'utf8');
console.log('Prerendered / (Angular bootstrap preserved)');
