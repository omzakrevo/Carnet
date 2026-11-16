// POST /api/compte : comptes des utilisateurs (inscription, connexion, profil, mot de passe)
// Les comptes sont enregistrés dans un dépôt GitHub PRIVÉ (variable COMPTES_REPO), un fichier par numéro.
const { CFG, readJson, writeJson, updateJson, hashKey, normCode, normTel, hashPwd, newSalt, samePwd,
  newSession, session, comptePath, body, fail } = require('./_lib');

const clean = (v, n = 60) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, n);
// Ce que l'application reçoit (jamais le mot de passe)
const profil = a => ({
  telephone: a.telephone, nom: a.nom, prenom: a.prenom, boutique: a.boutique, parrain: a.parrain || '',
  essaiFin: (a.essaiDebut || 0) + CFG.essaiHeures * 36e5, cle: a.cle || '', cree: a.cree,
});
async function cleValide(cle) {
  if (!cle) return '';
  const { data } = await readJson('licences.json', { licences: [] });
  return (data.licences || []).some(l => l.hash === hashKey(cle)) ? String(cle).trim().toUpperCase() : '';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  try {
    const b = body(req);
    const R = CFG.comptesRepo;

    if (b.action === 'inscription') {
      const prenom = clean(b.prenom), nom = clean(b.nom), boutique = clean(b.boutique, 80);
      const tel = normTel(b.telephone);
      if (!prenom || !nom || !boutique) return res.status(400).json({ error: 'Le prénom, le nom et le nom de la boutique sont obligatoires.' });
      if (tel.length < 8 || tel.length > 15) return res.status(400).json({ error: 'Numéro de téléphone invalide.' });
      if (String(b.motdepasse || '').length < 6) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
      let parrain = normCode(b.parrain);
      if (parrain) {
        const { data } = await readJson('parrains.json', { parrains: [] });
        if (!(data.parrains || []).some(p => p.code === parrain && p.actif !== false)) parrain = '';
      }
      const sel = newSalt();
      const compte = {
        tel, telephone: clean(b.telephone, 30), prenom, nom, boutique, parrain,
        sel, mdp: hashPwd(b.motdepasse, sel), cree: new Date().toISOString(), essaiDebut: Date.now(),
        cle: await cleValide(b.cle), // un utilisateur qui avait déjà une clé la rattache à son compte
      };
      const ok = await writeJson(comptePath(tel), compte, null, `Nouveau compte : ${boutique}`, R);
      if (!ok) return res.status(409).json({ error: 'Un compte existe déjà avec ce numéro. Connectez-vous.' });
      return res.status(200).json({ token: newSession(tel), compte: profil(compte) });
    }

    if (b.action === 'connexion') {
      const tel = normTel(b.telephone);
      const { data } = await readJson(comptePath(tel), null, R);
      if (!data || !samePwd(b.motdepasse, data)) return res.status(401).json({ error: 'Numéro ou mot de passe incorrect.' });
      if (data.bloque) return res.status(403).json({ error: 'Ce compte est suspendu. Contactez-nous.' });
      return res.status(200).json({ token: newSession(tel), compte: profil(data) });
    }

    // Les actions suivantes demandent d'être connecté
    const s = session(b.token);
    if (!s) return res.status(401).json({ error: 'Session expirée : reconnectez-vous.' });
    const path = comptePath(s.tel);

    if (b.action === 'moi') {
      const { data } = await readJson(path, null, R);
      if (!data) return res.status(401).json({ error: 'Compte introuvable.' });
      if (data.bloque) return res.status(403).json({ error: 'Ce compte est suspendu. Contactez-nous.' });
      return res.status(200).json({ compte: profil(data) });
    }

    if (b.action === 'lier') { // rattache une clé saisie à la main au compte
      const cle = await cleValide(b.cle);
      if (!cle) return res.status(400).json({ error: 'Clé inconnue.' });
      const data = await updateJson(path, null, 'Clé rattachée au compte', a => { if (!a || a.cle === cle) return false; a.cle = cle; }, R);
      return res.status(200).json({ compte: profil(data) });
    }

    if (b.action === 'motdepasse') {
      if (String(b.nouveau || '').length < 6) return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
      let refus = false;
      await updateJson(path, null, 'Changement de mot de passe', a => {
        if (!a || !samePwd(b.ancien, a)) { refus = true; return false; }
        a.sel = newSalt(); a.mdp = hashPwd(b.nouveau, a.sel);
      }, R);
      if (refus) return res.status(400).json({ error: 'Mot de passe actuel incorrect.' });
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'profil') {
      const data = await updateJson(path, null, 'Mise à jour du profil', a => {
        if (!a) return false;
        if (clean(b.prenom)) a.prenom = clean(b.prenom);
        if (clean(b.nom)) a.nom = clean(b.nom);
        if (clean(b.boutique, 80)) a.boutique = clean(b.boutique, 80);
      }, R);
      return res.status(200).json({ compte: profil(data) });
    }

    res.status(400).json({ error: 'Action inconnue.' });
  } catch (e) { fail(res, e); }
};
