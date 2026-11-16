/* Carnet de gestion des ventes — données stockées localement sur l'appareil */
(() => {
  'use strict';

  const KEY = 'carnet-ventes-v1';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // ---------- Stockage ----------
  const blank = () => ({ profile: { devise: 'FCFA' }, ventes: [], depenses: [] });
  let db = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      const d = JSON.parse(raw);
      return { ...blank(), ...d, profile: { ...blank().profile, ...(d.profile || {}) } };
    } catch { return blank(); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch { toast("Impossible d'enregistrer (stockage plein ?)"); }
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- Formats ----------
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => iso(new Date());
  const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };
  const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
  const money = n => `${nf.format(Math.round(n * 100) / 100)} ${db.profile.devise || 'FCFA'}`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
  const shortFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' });

  const total = v => num(v.qte) * num(v.pu);
  const reste = v => v.paiement === 'Crédit' ? Math.max(0, total(v) - num(v.paye)) : 0;

  // ---------- État ----------
  let curDay = today();
  let curMonth = curDay.slice(0, 7);
  let curView = 'ventes';

  // ---------- Navigation ----------
  function show(view) {
    curView = view;
    $$('.view').forEach(v => (v.hidden = v.id !== `view-${view}`));
    $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $('#fab').hidden = !['ventes', 'depenses'].includes(view);
    render();
    window.scrollTo(0, 0);
  }
  $$('.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));

  $$('[data-day]').forEach(b => b.addEventListener('click', () => {
    const d = parseIso(curDay); d.setDate(d.getDate() + Number(b.dataset.day));
    curDay = iso(d); render();
  }));
  $('#dayPicker').addEventListener('change', e => { if (e.target.value) { curDay = e.target.value; render(); } });
  $$('[data-month]').forEach(b => b.addEventListener('click', () => {
    const [y, m] = curMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + Number(b.dataset.month), 1);
    curMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; render();
  }));

  // ---------- Rendu ----------
  function render() {
    renderHeader();
    if (curView === 'ventes') renderVentes();
    if (curView === 'depenses') renderDepenses();
    if (curView === 'credits') renderCredits();
    if (curView === 'bilan') renderBilan();
    if (curView === 'profil') renderProfil();
    $$('.monthLabel').forEach(el => (el.textContent = monthFmt.format(parseIso(curMonth + '-01'))));
  }

  function renderHeader() {
    const p = db.profile;
    $('#brandName').textContent = p.marque || 'Carnet de gestion des ventes';
    $('#brandSub').textContent = [p.responsable, p.contacts, p.reseaux].filter(Boolean).join(' · ') || 'Touchez « Profil » pour personnaliser';
    $('.brand-mark').textContent = (p.marque || 'C').trim().charAt(0).toUpperCase();
  }

  function renderVentes() {
    $('#dayLabel').textContent = curDay === today() ? `Aujourd'hui · ${dayFmt.format(parseIso(curDay))}` : dayFmt.format(parseIso(curDay));
    $('#dayPicker').value = curDay;
    const list = db.ventes.filter(v => v.date === curDay).sort((a, b) => (a.heure || '').localeCompare(b.heure || ''));
    $('#ventesBody').innerHTML = list.map(v => `
      <tr data-id="${v.id}">
        <td>${esc(v.heure || '')}</td>
        <td>${esc(v.client || '—')}<span class="small">${esc(v.tel || '')}</span></td>
        <td>${esc(v.produit)}</td>
        <td class="num">${nf.format(num(v.qte))}</td>
        <td class="num">${money(num(v.pu))}</td>
        <td class="num"><b>${money(total(v))}</b></td>
        <td>${v.paiement === 'Crédit'
          ? (reste(v) > 0 ? `<span class="pill credit">Crédit · reste ${money(reste(v))}</span>` : `<span class="pill paid">Crédit soldé</span>`)
          : `<span class="pill">${esc(v.paiement)}</span>`}</td>
        <td>${esc(v.remise || '')}</td>
        <td>${esc(v.obs || '')}</td>
      </tr>`).join('');
    $('#ventesEmpty').hidden = list.length > 0;
    $('#sNb').textContent = list.length;
    $('#sCa').textContent = money(list.reduce((s, v) => s + total(v), 0));
    $('#sCr').textContent = money(list.reduce((s, v) => s + reste(v), 0));
  }
  $('#ventesBody').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-id]'); if (tr) openVente(tr.dataset.id);
  });

  function renderDepenses() {
    const list = db.depenses.filter(d => d.date.startsWith(curMonth)).sort((a, b) => b.date.localeCompare(a.date));
    $('#depBody').innerHTML = list.map(d => `
      <tr data-id="${d.id}">
        <td>${shortFmt.format(parseIso(d.date))}</td>
        <td>${esc(d.libelle)}</td>
        <td><span class="pill">${esc(d.categorie)}</span></td>
        <td class="num"><b>${money(num(d.montant))}</b></td>
        <td>${esc(d.paiement)}</td>
      </tr>`).join('');
    $('#depEmpty').hidden = list.length > 0;
    $('#dNb').textContent = list.length;
    $('#dTot').textContent = money(list.reduce((s, d) => s + num(d.montant), 0));
  }
  $('#depBody').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-id]'); if (tr) openDep(tr.dataset.id);
  });

  function renderCredits() {
    const list = db.ventes.filter(v => reste(v) > 0).sort((a, b) => a.date.localeCompare(b.date));
    const clients = new Set(list.map(v => (v.client || '') + '|' + (v.tel || '')));
    $('#cNb').textContent = clients.size;
    $('#cTot').textContent = money(list.reduce((s, v) => s + reste(v), 0));
    $('#creditEmpty').hidden = list.length > 0;
    $('#creditList').innerHTML = list.map(v => {
      const tel = (v.tel || '').replace(/[^\d+]/g, '');
      return `<li data-id="${v.id}">
        <div class="info">
          <div class="who">${esc(v.client || 'Client sans nom')}</div>
          <div class="what">${esc(v.produit)} · ${nf.format(num(v.qte))} × ${money(num(v.pu))} · ${shortFmt.format(parseIso(v.date))}
            ${tel ? ` · <a href="tel:${esc(tel)}">${esc(v.tel)}</a>` : ''}</div>
          <div class="amt">Reste : ${money(reste(v))}</div>
        </div>
        <button class="btn small" data-pay="${v.id}">Encaisser</button>
      </li>`;
    }).join('');
  }
  $('#creditList').addEventListener('click', e => {
    const b = e.target.closest('[data-pay]');
    if (b) {
      const v = db.ventes.find(x => x.id === b.dataset.pay); if (!v) return;
      const r = reste(v);
      const ans = prompt(`Montant reçu de ${v.client || 'ce client'} (reste ${money(r)}) :`, String(r));
      if (ans === null) return;
      const amt = Math.min(num(ans), r);
      if (amt <= 0) return;
      v.paye = num(v.paye) + amt;
      v.paiements = [...(v.paiements || []), { date: today(), montant: amt }];
      save(); render();
      toast(reste(v) > 0 ? `Encaissé ${money(amt)} · reste ${money(reste(v))}` : 'Crédit soldé ✔');
      return;
    }
    const li = e.target.closest('li[data-id]');
    if (li && !e.target.closest('a')) openVente(li.dataset.id);
  });

  function renderBilan() {
    const ventes = db.ventes.filter(v => v.date.startsWith(curMonth));
    const deps = db.depenses.filter(d => d.date.startsWith(curMonth));
    const ca = ventes.reduce((s, v) => s + total(v), 0);
    const cr = ventes.reduce((s, v) => s + reste(v), 0);
    const dep = deps.reduce((s, d) => s + num(d.montant), 0);
    $('#bCa').textContent = money(ca);
    $('#bDep').textContent = money(dep);
    $('#bBen').textContent = money(ca - dep);
    $('#bBenBox').className = 'stat ' + (ca - dep >= 0 ? 'good' : 'warn');
    $('#bNb').textContent = ventes.length;
    $('#bEnc').textContent = money(ca - cr);
    $('#bCr').textContent = money(cr);

    const [y, m] = curMonth.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    const perDay = Array.from({ length: days }, () => 0);
    ventes.forEach(v => { perDay[Number(v.date.slice(8, 10)) - 1] += total(v); });
    const max = Math.max(1, ...perDay);
    $('#bars').innerHTML = perDay.map((t, i) =>
      `<div class="bar ${t ? '' : 'zero'}" style="height:${Math.max(1, (t / max) * 100)}%" title="${i + 1} : ${money(t)}"></div>`).join('');
    let legend = $('#bars').nextElementSibling;
    if (!legend || !legend.classList.contains('bars-legend')) {
      legend = document.createElement('div'); legend.className = 'bars-legend'; $('#bars').after(legend);
    }
    legend.innerHTML = `<span>1</span><span>${Math.ceil(days / 2)}</span><span>${days}</span>`;

    const byProd = {};
    ventes.forEach(v => {
      const k = (v.produit || '').trim() || '—';
      byProd[k] = byProd[k] || { q: 0, t: 0 }; byProd[k].q += num(v.qte); byProd[k].t += total(v);
    });
    const top = Object.entries(byProd).sort((a, b) => b[1].t - a[1].t).slice(0, 5);
    $('#topProduits').innerHTML = top.length
      ? top.map(([k, o]) => `<li><span>${esc(k)} <span class="muted">(${nf.format(o.q)})</span></span><b>${money(o.t)}</b></li>`).join('')
      : '<li class="muted">Pas encore de ventes ce mois.</li>';

    const byPay = {};
    ventes.forEach(v => { byPay[v.paiement] = (byPay[v.paiement] || 0) + total(v); });
    const pays = Object.entries(byPay).sort((a, b) => b[1] - a[1]);
    $('#topPaiements').innerHTML = pays.length
      ? pays.map(([k, t]) => `<li><span>${esc(k)}</span><b>${money(t)} · ${Math.round((t / ca) * 100)} %</b></li>`).join('')
      : '<li class="muted">—</li>';
  }

  function renderProfil() {
    const f = $('#profilForm');
    ['marque', 'responsable', 'contacts', 'reseaux', 'devise'].forEach(k => (f.elements[k].value = db.profile[k] || ''));
  }
  $('#profilForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    ['marque', 'responsable', 'contacts', 'reseaux', 'devise'].forEach(k => (db.profile[k] = f.elements[k].value.trim()));
    if (!db.profile.devise) db.profile.devise = 'FCFA';
    save(); render(); toast('Profil enregistré');
  });

  // ---------- Formulaire vente ----------
  const vDlg = $('#venteDlg'), vForm = $('#venteForm');
  let editVente = null;

  function fillDatalists() {
    const uniq = arr => [...new Set(arr.filter(Boolean).map(s => s.trim()))].sort((a, b) => a.localeCompare(b, 'fr'));
    $('#clientsList').innerHTML = uniq(db.ventes.map(v => v.client)).map(c => `<option value="${esc(c)}">`).join('');
    $('#produitsList').innerHTML = uniq(db.ventes.map(v => v.produit)).map(c => `<option value="${esc(c)}">`).join('');
  }
  function updateTotal() {
    const t = num(vForm.elements.qte.value) * num(vForm.elements.pu.value);
    vForm.elements.total.value = money(t);
    const credit = vForm.elements.paiement.value === 'Crédit';
    $('.avance', vForm).hidden = !credit;
  }
  ['qte', 'pu', 'paiement'].forEach(n => vForm.elements[n].addEventListener('input', updateTotal));

  // Pré-remplir le numéro et le dernier prix connus
  vForm.elements.client.addEventListener('change', () => {
    const c = vForm.elements.client.value.trim();
    const last = [...db.ventes].reverse().find(v => v.client === c && v.tel);
    if (last && !vForm.elements.tel.value) vForm.elements.tel.value = last.tel;
  });
  vForm.elements.produit.addEventListener('change', () => {
    const p = vForm.elements.produit.value.trim();
    const last = [...db.ventes].reverse().find(v => v.produit === p);
    if (last && !vForm.elements.pu.value) { vForm.elements.pu.value = last.pu; updateTotal(); }
  });

  function openVente(id) {
    fillDatalists();
    editVente = id ? db.ventes.find(v => v.id === id) : null;
    const v = editVente || {
      date: curDay, heure: curDay === today() ? `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}` : '',
      qte: 1, paiement: 'Espèces', remise: 'Sur place'
    };
    const f = vForm.elements;
    f.date.value = v.date; f.heure.value = v.heure || ''; f.client.value = v.client || ''; f.tel.value = v.tel || '';
    f.produit.value = v.produit || ''; f.qte.value = v.qte ?? 1; f.pu.value = v.pu ?? '';
    f.paiement.value = v.paiement || 'Espèces'; f.remise.value = v.remise || 'Sur place';
    f.avance.value = v.paiement === 'Crédit' ? (v.paye || 0) : 0; f.obs.value = v.obs || '';
    $('#venteDel').hidden = !editVente;
    updateTotal();
    vDlg.showModal();
    if (!editVente) f.client.focus();
  }

  vDlg.addEventListener('close', () => {
    const action = vDlg.returnValue; vDlg.returnValue = '';
    if (action === 'delete' && editVente) {
      if (!confirm('Supprimer cette vente ?')) return;
      db.ventes = db.ventes.filter(v => v !== editVente);
      save(); render(); toast('Vente supprimée'); return;
    }
    if (action !== 'save') return;
    const f = vForm.elements;
    const data = {
      date: f.date.value || curDay, heure: f.heure.value, client: f.client.value.trim(), tel: f.tel.value.trim(),
      produit: f.produit.value.trim(), qte: num(f.qte.value), pu: num(f.pu.value),
      paiement: f.paiement.value, remise: f.remise.value, obs: f.obs.value.trim()
    };
    data.paye = data.paiement === 'Crédit' ? num(f.avance.value) : total(data);
    if (editVente) Object.assign(editVente, data);
    else db.ventes.push({ id: uid(), createdAt: Date.now(), ...data });
    curDay = data.date;
    save(); render(); toast(editVente ? 'Vente modifiée' : 'Vente ajoutée ✔');
  });

  // ---------- Formulaire dépense ----------
  const dDlg = $('#depDlg'), dForm = $('#depForm');
  let editDep = null;
  function openDep(id) {
    editDep = id ? db.depenses.find(d => d.id === id) : null;
    const d = editDep || { date: curMonth === today().slice(0, 7) ? today() : curMonth + '-01', categorie: 'Achat de stock', paiement: 'Espèces' };
    const f = dForm.elements;
    f.date.value = d.date; f.libelle.value = d.libelle || ''; f.categorie.value = d.categorie;
    f.montant.value = d.montant ?? ''; f.paiement.value = d.paiement;
    $('#depDel').hidden = !editDep;
    dDlg.showModal();
  }
  dDlg.addEventListener('close', () => {
    const action = dDlg.returnValue; dDlg.returnValue = '';
    if (action === 'delete' && editDep) {
      if (!confirm('Supprimer cette dépense ?')) return;
      db.depenses = db.depenses.filter(d => d !== editDep);
      save(); render(); toast('Dépense supprimée'); return;
    }
    if (action !== 'save') return;
    const f = dForm.elements;
    const data = { date: f.date.value, libelle: f.libelle.value.trim(), categorie: f.categorie.value, montant: num(f.montant.value), paiement: f.paiement.value };
    if (editDep) Object.assign(editDep, data); else db.depenses.push({ id: uid(), ...data });
    curMonth = data.date.slice(0, 7);
    save(); render(); toast(editDep ? 'Dépense modifiée' : 'Dépense ajoutée ✔');
  });

  $('#fab').addEventListener('click', () => (curView === 'depenses' ? openDep() : openVente()));

  // ---------- Export / sauvegarde ----------
  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $('#exportCsv').addEventListener('click', () => {
    const cols = ['Date', 'Heure', 'Client', 'Numéro', 'Produit', 'Qté', 'Prix unitaire', 'Prix total', 'Mode de paiement', 'Reste à payer', 'Mode de remise', 'Observations'];
    const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = [...db.ventes].sort((a, b) => (a.date + (a.heure || '')).localeCompare(b.date + (b.heure || '')))
      .map(v => [v.date, v.heure, v.client, v.tel, v.produit, v.qte, v.pu, total(v), v.paiement, reste(v), v.remise, v.obs].map(q).join(';'));
    download(`ventes-${today()}.csv`, '﻿' + [cols.map(q).join(';'), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
  });
  $('#exportJson').addEventListener('click', () => download(`carnet-sauvegarde-${today()}.json`, JSON.stringify(db, null, 2), 'application/json'));
  $('#importJson').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!Array.isArray(d.ventes) || !Array.isArray(d.depenses)) throw new Error();
      if (!confirm(`Remplacer les données actuelles par cette sauvegarde (${d.ventes.length} ventes, ${d.depenses.length} dépenses) ?`)) return;
      db = { ...blank(), ...d, profile: { ...blank().profile, ...(d.profile || {}) } };
      save(); render(); toast('Sauvegarde restaurée');
    } catch { toast('Fichier de sauvegarde invalide'); }
    e.target.value = '';
  });
  $('#wipe').addEventListener('click', () => {
    if (!confirm('Effacer TOUTES les ventes, dépenses et le profil ? Cette action est définitive.')) return;
    if (!confirm('Vraiment sûr ? Pensez à télécharger une sauvegarde avant.')) return;
    db = blank(); save(); render(); toast('Données effacées');
  });
  $('#printDay').addEventListener('click', () => window.print());

  // ---------- Divers ----------
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  show('ventes');
})();
