// Outils partagés par les fonctions serveur (Vercel). Les fichiers commençant par « _ » ne sont pas des adresses publiques.
const crypto = require('crypto');

const CFG = {
  owner: process.env.GITHUB_OWNER || 'omzakrevo',
  repo: process.env.GITHUB_REPO || 'Carnet',
  branch: process.env.GITHUB_BRANCH || 'main',
  prixMois: Number(process.env.PRIX_MOIS || 1000),            // FCFA par mois
  commission: Number(process.env.COMMISSION_PARRAIN || 0.25), // part du parrain sur chaque paiement
  moisAutorises: [1, 3, 6, 12],
  pays: process.env.SASPAY_COUNTRY || 'BF',
  saspay: 'https://api.saspay.me/api/v1',
  comptesRepo: process.env.COMPTES_REPO || 'carnet-comptes', // dépôt GitHub PRIVÉ des comptes
  essaiHeures: Number(process.env.ESSAI_HEURES || 24),
};

function need(name) {
  const v = process.env[name];
  if (!v) { const e = new Error(`Configuration incomplète : la variable ${name} n'est pas définie sur Vercel.`); e.status = 500; throw e; }
  return v;
}

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const today = () => iso(new Date());
// Ajoute n mois à partir de la date de fin (ou d'aujourd'hui si elle est passée)
function addMonths(expire, n) {
  const base = expire && expire > today() ? expire : today();
  const d = new Date(base + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + n);
  return iso(d);
}

// ---------- GitHub : lecture / écriture des fichiers JSON du dépôt ----------
async function gh(path, opts = {}, repo = CFG.repo) {
  const url = `https://api.github.com/repos/${CFG.owner}/${repo}/contents/${path}` + (opts.method ? '' : `?ref=${encodeURIComponent(CFG.branch)}`);
  return fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${need('GITHUB_TOKEN')}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'carnet-ventes',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}
async function readJson(path, fallback, repo) {
  const r = await gh(path, {}, repo);
  if (r.status === 404) return { data: JSON.parse(JSON.stringify(fallback)), sha: null };
  if (!r.ok) throw new Error(`Lecture GitHub impossible (${r.status})`);
  const j = await r.json();
  return { data: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')), sha: j.sha };
}
async function writeJson(path, data, sha, message, repo) {
  const r = await gh(path, {
    method: 'PUT',
    body: JSON.stringify({
      message, branch: CFG.branch,
      content: Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8').toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  }, repo);
  if (r.status === 409 || r.status === 422) return false; // le fichier a changé entre-temps : on relit
  if (!r.ok) throw new Error(`Écriture GitHub impossible (${r.status})`);
  return true;
}
// Lit, modifie et réécrit un fichier ; réessaie si quelqu'un l'a modifié en même temps.
// mutate(data) renvoie false s'il n'y a rien à écrire.
async function updateJson(path, fallback, message, mutate, repo) {
  for (let i = 0; i < 4; i++) {
    const { data, sha } = await readJson(path, fallback, repo);
    if (mutate(data) === false) return data;
    if (await writeJson(path, data, sha, message, repo)) return data;
  }
  throw new Error('GitHub est occupé, réessayez dans un instant.');
}

// ---------- Signatures et clés ----------
const hmac = s => crypto.createHmac('sha256', need('LICENCE_SECRET')).update(s);
// La commande est signée par le serveur : le client ne peut pas modifier la durée ou le montant
function sign(obj) {
  const p = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return p + '.' + hmac(p).digest('base64url');
}
function unsign(token) {
  const [p, s] = String(token || '').split('.');
  if (!p || !s) return null;
  const e = hmac(p).digest('base64url');
  if (e.length !== s.length || !crypto.timingSafeEqual(Buffer.from(e), Buffer.from(s))) return null;
  try { return JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); } catch { return null; }
}
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// La clé d'un paiement est toujours la même : une confirmation répétée redonne la même clé
function keyFor(sessionId) {
  const h = hmac('cle:' + sessionId).digest();
  let c = '';
  for (let i = 0; i < 12; i++) c += ALPHA[h[i] % ALPHA.length];
  return `CARNET-${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
}
const normKey = k => String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashKey = k => crypto.createHash('sha256').update(normKey(k)).digest('hex');
const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);

// ---------- Comptes ----------
// Numéro normalisé : chiffres seulement, indicatif 226 ajouté aux numéros burkinabè à 8 chiffres
function normTel(t) {
  let d = String(t || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 8) d = '226' + d;
  return d;
}
// Mot de passe : PBKDF2-SHA256 (le même calcul est fait dans admin.html pour réinitialiser un mot de passe)
const hashPwd = (pwd, sel) => crypto.pbkdf2Sync(String(pwd), sel, 100000, 32, 'sha256').toString('hex');
const newSalt = () => crypto.randomBytes(16).toString('hex');
const samePwd = (pwd, acc) => {
  const a = Buffer.from(hashPwd(pwd, acc.sel), 'hex'), b = Buffer.from(String(acc.mdp || ''), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const SESSION_JOURS = 180;
const newSession = tel => sign({ typ: 'session', tel, exp: Date.now() + SESSION_JOURS * 864e5 });
function session(token) {
  const s = unsign(token);
  return s && s.typ === 'session' && s.tel && s.exp > Date.now() ? s : null;
}
const comptePath = tel => `comptes/${tel}.json`;

function body(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return req.body;
}
function fail(res, e) {
  console.error(e);
  res.status(e.status || 500).json({ error: e.message || 'Erreur serveur' });
}

module.exports = { CFG, need, today, addMonths, readJson, writeJson, updateJson, sign, unsign, keyFor, hashKey, normCode, normTel,
  hashPwd, newSalt, samePwd, newSession, session, comptePath, body, fail };
