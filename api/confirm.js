// POST /api/confirm : vérifie le paiement chez SasPay puis crée ou prolonge la licence sur GitHub
// et enregistre la commission du parrain. Peut être appelé plusieurs fois sans risque.
const { CFG, need, today, addMonths, updateJson, unsign, keyFor, hashKey, body, fail } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  try {
    const c = unsign(body(req).commande);
    if (!c || !c.sid) return res.status(400).json({ error: 'Commande invalide.' });

    const r = await fetch(`${CFG.saspay}/checkout-sessions/${encodeURIComponent(c.sid)}/status/`, {
      headers: { Authorization: `Bearer ${need('SASPAY_API_KEY')}` },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.data) return res.status(502).json({ error: 'SasPay ne répond pas, réessayez.' });
    const st = j.data.status, ts = j.data.transaction_status;
    if (!(st === 'PAID' && ts === 'SUCCESS')) {
      const echec = st === 'EXPIRED' || st === 'CANCELLED' || ts === 'FAILED' || ts === 'CANCELLED';
      return res.status(200).json({ statut: echec ? 'echec' : 'attente', detail: `${st || ''} ${ts || ''}`.trim() });
    }

    // Paiement réussi : licence
    const cle = c.renouveler ? null : keyFor(c.sid);
    const hash = c.renouveler || hashKey(cle);
    let entree = null;
    await updateJson('licences.json', { vendeur: {}, licences: [] }, `Paiement SasPay ${c.sid} : ${c.mois} mois (${c.boutique})`, data => {
      data.licences = data.licences || [];
      let l = data.licences.find(x => x.hash === hash);
      if (l && (l.paiements || []).includes(c.sid)) { entree = l; return false; } // déjà traité
      if (!l) {
        const n = data.licences.reduce((m, x) => Math.max(m, parseInt(String(x.id || '').replace(/\D/g, ''), 10) || 0), 0) + 1;
        l = { id: 'L' + String(n).padStart(4, '0'), boutique: c.boutique, telephone: '', hash, expire: today(), actif: true,
          parrain: c.parrain || '', note: 'Abonnement payé via SasPay', cree: today(), paiements: [] };
        data.licences.push(l);
      }
      if (l.expire !== '') l.expire = addMonths(l.expire, c.mois); // "" = licence sans limite, on n'y touche pas
      l.actif = true;
      if (!l.parrain && c.parrain) l.parrain = c.parrain;
      l.paiements = [...(l.paiements || []), c.sid];
      entree = l;
    });

    // Commission du parrain (sur chaque paiement de ses filleuls)
    const code = entree.parrain || c.parrain;
    if (code && CFG.commission > 0) {
      await updateJson('commissions.json', { commissions: [] }, `Commission ${code} : paiement ${c.sid}`, data => {
        data.commissions = data.commissions || [];
        if (data.commissions.some(x => x.session === c.sid)) return false;
        data.commissions.push({
          date: today(), parrain: code, licence: entree.id, boutique: entree.boutique,
          vente: c.montant, montant: Math.round(c.montant * CFG.commission), session: c.sid, paye: false,
        });
      });
    }

    res.status(200).json({ statut: 'ok', cle, licence: { id: entree.id, hash, boutique: entree.boutique, expire: entree.expire } });
  } catch (e) { fail(res, e); }
};
