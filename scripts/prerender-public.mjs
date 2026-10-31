import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Static HTML snapshots of the four public Angular templates. The browser app
// remains available for interactive routes; public pages do not need JS to read.
const base = 'dist/portfolio-simulator';
const out = existsSync(join(base, 'browser', 'index.html')) ? join(base, 'browser') : base;
const shell = readFileSync(join(out, 'index.html'), 'utf8');
const info = readFileSync('src/app/features/public/public-info.component.ts', 'utf8');
const legal = readFileSync('src/app/features/public/public-legal.component.ts', 'utf8');
const template = source => source.match(/template:\s*`([\s\S]*?)`,\s*styles:/)?.[1];
const styles = source => source.match(/styles:\s*\[\s*`([\s\S]*?)`\s*\]/)?.[1];
if (!template(info) || !template(legal)) throw Error('Public component templates changed; update prerender extractor.');
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
    body = body.replace(/<div class="actions">[\s\S]*?<\/div>/, '<p><a href="/cookies?gestisci=1">Gestisci le preferenze nell’applicazione</a></p>');
  }
  const css = styles(route === 'chi-siamo' ? info : legal);
  const head = shell.slice(0, shell.indexOf('</head>'))
    .replace(/<title>[\s\S]*?<\/title>/, '<title>' + title + '</title>')
    .replace(/<meta name="description"[^>]*>/, '<meta name="description" content="' + description + '">')
    .replace(/<link rel="canonical"[^>]*>/, '<link rel="canonical" href="https://razeretf.com/' + route + '">');
  const html = head + '<meta name="robots" content="index,follow"><style>' + css + '</style></head><body>' + body + '</body></html>';
  const dir = join(out, route);
  mkdirSync(dir, {recursive:true});
  writeFileSync(join(dir, 'index.html'), html, 'utf8');
  console.log('Prerendered /' + route);
}
