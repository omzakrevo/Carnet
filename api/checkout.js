// POST /api/checkout : crée une page de paiement SasPay pour l'abonnement
const { CFG, need, readJson, sign, normCode, session, comptePath, body, fail } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  try {
    const b = body(req);
    // Compte de l'utilisateur connecté : sa boutique, son numéro et son parrain font foi
    const s = session(b.token);
    let compte = null;
    if (s) { try { compte = (await readJson(comptePath(s.tel), null, CFG.comptesRepo)).data; } catch { compte = null; } }
    if (compte) { b.boutique = b.boutique || compte.boutique; b.telephone = compte.telephone || b.telephone; if (compte.parrain) b.parrain = compte.parrain; }
    const mois = Number(b.mois);
    if (!CFG.moisAutorises.includes(mois)) return res.status(400).json({ error: 'Durée invalide.' });
    const boutique = String(b.boutique || '').trim().slice(0, 80);
    const telephone = String(b.telephone || '').trim().slice(0, 30);
    if (!telephone.replace(/\D/g, '')) return res.status(400).json({ error: 'Le numéro de téléphone est obligatoire.' });

    // Renouvellement d'une licence existante (identifiée par l'empreinte de sa clé)
    let renouveler = /^[a-f0-9]{64}$/.test(b.renouveler || '') ? b.renouveler : '';
    let nomLicence = '';
    if (renouveler) {
      const { data } = await readJson('licences.json', { licences: [] });
      const l = (data.licences || []).find(x => x.hash === renouveler);
      if (!l) renouveler = ''; else nomLicence = l.boutique || '';
    }
    if (!renouveler && !boutique) return res.status(400).json({ error: 'Le nom de la boutique est obligatoire.' });

    // Code parrain : gardé seulement s'il existe et est actif
    let parrain = normCode(b.parrain);
    if (parrain) {
      const { data } = await readJson('parrains.json', { parrains: [] });
      if (!(data.parrains || []).some(p => p.code === parrain && p.actif !== false)) parrain = '';
    }

    const nom = boutique || nomLicence || 'Client Carnet';
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email || '').trim())
      ? String(b.email).trim()
      : `client${telephone.replace(/\D/g, '')}@${process.env.EMAIL_DOMAINE || 'carnet-ventes.vercel.app'}`;
    const montant = CFG.prixMois * mois;
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const origin = `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;

    const r = await fetch(`${CFG.saspay}/checkout-sessions/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${need('SASPAY_API_KEY')}` },
      body: JSON.stringify({
        amount: montant.toFixed(2),
        currency: 'XOF',
        country: CFG.pays,
        description: `Carnet des ventes : abonnement ${mois} mois (${nom})`.slice(0, 120),
        customer_name: nom,
        customer_email: email,
        return_url: `${origin}/?paiement=retour`,
        metadata: { app: 'carnet', mois, parrain, renouveler },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.data || !j.data.checkout_url) {
      const msg = (j.error && (j.error.message || JSON.stringify(j.error))) || `erreur ${r.status}`;
      return res.status(502).json({ error: `SasPay : ${msg}` });
    }
    const commande = sign({ sid: j.data.id, mois, montant, boutique: nom, parrain, renouveler, tel: compte ? compte.tel : '', t: Date.now() });
    res.status(200).json({ checkout_url: j.data.checkout_url, commande, montant });
  } catch (e) { fail(res, e); }
};
