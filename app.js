/* Carnet de gestion des ventes — données stockées localement sur l'appareil */
(() => {
  'use strict';

  const KEY = 'carnet-ventes-v1';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // ---------- Stockage ----------
  const blank = () => ({ profile: { devise: 'FCFA' }, ventes: [], depenses: [], articles: [] });
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

  // ---------- Clients ----------
  const ORD = 'Client ordinaire';
  // Numéro normalisé : chiffres seulement, 8 derniers (ignore +226 / 00226)
  const normTel = t => { let d = String(t || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); return d.length > 8 ? d.slice(-8) : d; };
  const normName = n => String(n || '').trim().toLowerCase();
  const isOrd = v => (!v.client && !v.tel) || normName(v.client) === normName(ORD);

  // Regroupe les ventes par client (par numéro, sinon par nom)
  function buildClients() {
    const sorted = [...db.ventes].sort((a, b) => (a.date + (a.heure || '')).localeCompare(b.date + (b.heure || '')));
    const nameToKey = new Map();
    sorted.forEach(v => { const t = normTel(v.tel); if (t.length >= 6 && v.client && !isOrd(v)) nameToKey.set(normName(v.client), 't:' + t); });
    const keyOf = v => { const t = normTel(v.tel); return t.length >= 6 ? 't:' + t : (nameToKey.get(normName(v.client)) || 'n:' + normName(v.client)); };
    const map = new Map();
    sorted.forEach(v => {
      if (isOrd(v)) return;
      const k = keyOf(v);
      let c = map.get(k);
      if (!c) { c = { key: k, name: '', tel: '', n: 0, total: 0, reste: 0, first: v.date, last: v.date, mN: 0, mT: 0, ventes: [] }; map.set(k, c); }
      if (v.client) c.name = v.client;
      if (v.tel) c.tel = v.tel;
      c.n++; c.total += total(v); c.reste += reste(v); c.last = v.date; c.ventes.push(v);
      if (v.date.startsWith(curMonth)) { c.mN++; c.mT += total(v); }
    });
    return [...map.values()];
  }
  const findByTel = tel => { const t = normTel(tel); return t.length >= 8 ? buildClients().find(c => normTel(c.tel) === t) : null; };
  const matchClient = (c, q) => {
    if (!q) return true;
    const d = q.replace(/\D/g, '');
    return normName(c.name).includes(normName(q)) || (d.length >= 2 && String(c.tel).replace(/\D/g, '').includes(d));
  };
  const initials = n => (String(n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2) || '?').toUpperCase();

  // ---------- Articles (catalogue de la boutique) ----------
  const findArticle = nom => { const n = normName(nom); return n ? db.articles.find(a => normName(a.nom) === n) : null; };
  const isOfArticle = (v, a) => v.articleId ? v.articleId === a.id : normName(v.produit) === normName(a.nom);
  const soldQty = a => db.ventes.reduce((s, v) => s + (isOfArticle(v, a) ? num(v.qte) : 0), 0);
  const tracked = a => a.stock !== '' && a.stock != null;
  // Stock restant = stock enregistré - quantités vendues (null si le stock n'est pas suivi)
  const stockLeft = a => tracked(a) ? num(a.stock) - soldQty(a) : null;
  const byName = (a, b) => a.nom.localeCompare(b.nom, 'fr');
  // Articles les plus vendus d'abord
  function popularArticles() {
    const count = {};
    db.ventes.forEach(v => { const a = v.articleId ? db.articles.find(x => x.id === v.articleId) : findArticle(v.produit); if (a) count[a.id] = (count[a.id] || 0) + 1; });
    return [...db.articles].sort((a, b) => (count[b.id] || 0) - (count[a.id] || 0) || byName(a, b));
  }
  function stockText(a) {
    const s = stockLeft(a);
    if (s === null) return 'Stock non suivi';
    return s <= 0 ? '<span class="stock-low">Rupture de stock</span>' : `${s <= 3 ? '<span class="stock-low">' : '<span>'}Stock : ${nf.format(s)}</span>`;
  }

  // ---------- État ----------
  let curDay = today();
  let curMonth = curDay.slice(0, 7);
  let curView = 'ventes';

  // ---------- Navigation ----------
  function show(view) {
    curView = view;
    $$('.view').forEach(v => (v.hidden = v.id !== `view-${view}`));
    $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $('#fab').hidden = !['ventes', 'depenses', 'articles'].includes(view);
    render();
    window.scrollTo(0, 0);
  }
  $$('.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
  $('#btnProfil').addEventListener('click', () => show('profil'));

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
    if (curView === 'clients') renderClients();
    if (curView === 'articles') renderArticles();
    if (curView === 'bilan') renderBilan();
    if (curView === 'profil') renderProfil();
    $$('.monthLabel').forEach(el => (el.textContent = monthFmt.format(parseIso(curMonth + '-01'))));
  }

  function renderHeader() {
    const p = db.profile;
    $('#brandName').textContent = p.marque || 'Carnet de gestion des ventes';
    $('#brandSub').textContent = [p.responsable, p.contacts, p.reseaux].filter(Boolean).join(' · ') || 'Touchez ⚙️ pour personnaliser';
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

  function clientItem(c, withMonth) {
    return `<li data-key="${esc(c.key)}">
      <span class="avatar">${esc(initials(c.name))}</span>
      <div class="info">
        <div class="who">${esc(c.name || 'Sans nom')}</div>
        <div class="what">${esc(c.tel || 'Pas de numéro')} · ${c.n} achat${c.n > 1 ? 's' : ''} au total${c.reste > 0 ? ` · <span style="color:var(--warn)">doit ${money(c.reste)}</span>` : ''}</div>
      </div>
      <div class="side">${withMonth
        ? (c.mN ? `<b>${money(c.mT)}</b>${c.mN} achat${c.mN > 1 ? 's' : ''} ce mois` : `<b>${money(c.total)}</b>au total`)
        : `<b>${money(c.total)}</b>dernier : ${shortFmt.format(parseIso(c.last))}`}</div>
    </li>`;
  }

  function renderClients() {
    const all = buildClients();
    const mois = all.filter(c => c.mN > 0).sort((a, b) => b.mT - a.mT);
    const top = mois[0];
    const box = $('#clientMois');
    box.className = 'star' + (top ? '' : ' none');
    box.dataset.key = top ? top.key : '';
    box.innerHTML = top
      ? `<div class="crown">👑</div><div><small>Client du mois</small><strong>${esc(top.name || top.tel)}</strong>
         <span>${top.mN} achat${top.mN > 1 ? 's' : ''} · ${money(top.mT)} ce mois</span></div>`
      : `<div class="crown">👑</div><div>Le client du mois apparaîtra ici dès la première vente à un client enregistré.</div>`;
    $('#clNb').textContent = mois.length;
    $('#clNew').textContent = all.filter(c => c.first.startsWith(curMonth)).length;
    $('#clOrd').textContent = db.ventes.filter(v => isOrd(v) && v.date.startsWith(curMonth)).length + ' ventes';

    const q = $('#clSearch').value.trim();
    // Classement : clients du mois d'abord (par montant), puis les autres (par dernière visite)
    const others = all.filter(c => !c.mN).sort((a, b) => b.last.localeCompare(a.last));
    const list = [...mois, ...others].filter(c => matchClient(c, q));
    $('#clientList').innerHTML = list.map(c => clientItem(c, true)).join('');
    $('#clientEmpty').hidden = list.length > 0;
    $('#clientEmpty').textContent = all.length ? 'Aucun client ne correspond à la recherche.' : "Aucun client enregistré pour l'instant.";
  }
  $('#clSearch').addEventListener('input', renderClients);
  $('#clientList').addEventListener('click', e => { const li = e.target.closest('li[data-key]'); if (li) openClient(li.dataset.key); });
  $('#clientMois').addEventListener('click', e => { const k = e.currentTarget.dataset.key; if (k) openClient(k); });

  // Fiche client
  const cDlg = $('#clientDlg');
  let curClient = null;
  function openClient(key) {
    const c = buildClients().find(x => x.key === key); if (!c) return;
    curClient = c;
    const tel = String(c.tel || '').replace(/[^\d+]/g, '');
    const wa = normTel(c.tel).length === 8 ? '226' + normTel(c.tel) : tel.replace('+', '');
    $('#cdName').textContent = c.name || c.tel;
    $('#cdBody').innerHTML = `
      ${tel ? `<div class="cd-contact"><a class="btn small ghost" href="tel:${esc(tel)}">📞 Appeler</a>
        <a class="btn small ghost" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">💬 WhatsApp</a>
        <span class="muted" style="align-self:center">${esc(c.tel)}</span></div>` : ''}
      <div class="cd-stats">
        <div class="stat"><span>Achats au total</span><strong>${c.n}</strong></div>
        <div class="stat accent"><span>Montant total</span><strong>${money(c.total)}</strong></div>
        <div class="stat"><span>Ce mois</span><strong>${c.mN} · ${money(c.mT)}</strong></div>
        <div class="stat ${c.reste > 0 ? 'warn' : 'good'}"><span>Reste à payer</span><strong>${money(c.reste)}</strong></div>
      </div>
      <p class="muted" style="margin:0 0 6px">Client depuis le ${dayFmt.format(parseIso(c.first))}</p>
      <ul class="history">${[...c.ventes].reverse().map(v => `<li>
        <div>${esc(v.produit)} <span class="muted">× ${nf.format(num(v.qte))}</span>
          <div class="what">${shortFmt.format(parseIso(v.date))} · ${esc(v.paiement)}${reste(v) > 0 ? ` · reste ${money(reste(v))}` : ''}</div></div>
        <b>${money(total(v))}</b></li>`).join('')}</ul>`;
    cDlg.showModal();
  }
  $('#cdClose').addEventListener('click', () => cDlg.close());
  $('#cdSale').addEventListener('click', () => {
    const c = curClient; cDlg.close();
    if (curView !== 'ventes') show('ventes');
    openVente(null, { client: c.name, tel: c.tel });
  });

  // ---------- Vue Articles ----------
  function articleItem(a, withMonth) {
    const mois = withMonth ? db.ventes.filter(v => v.date.startsWith(curMonth) && isOfArticle(v, a)).reduce((s, v) => s + num(v.qte), 0) : 0;
    return `<li data-art="${a.id}">
      <span class="avatar">${esc(initials(a.nom))}</span>
      <div class="info">
        <div class="who">${esc(a.nom)}</div>
        <div class="what">${stockText(a)}${a.cat ? ` · ${esc(a.cat)}` : ''}${withMonth && mois ? ` · ${nf.format(mois)} vendu${mois > 1 ? 's' : ''} ce mois` : ''}</div>
      </div>
      <div class="side"><b>${money(num(a.prix))}</b>${a.achat !== '' && a.achat != null ? `achat ${money(num(a.achat))}` : ''}</div>
    </li>`;
  }
  function renderArticles() {
    const q = normName($('#aSearch').value);
    const list = [...db.articles].sort(byName).filter(a => !q || normName(a.nom).includes(q) || normName(a.cat).includes(q));
    $('#articleList').innerHTML = list.map(a => articleItem(a, true)).join('');
    $('#articleEmpty').hidden = list.length > 0;
    $('#articleEmpty').innerHTML = db.articles.length ? 'Aucun article ne correspond.' : 'Aucun article. Touchez <b>+</b> pour ajouter les articles de votre boutique.';
    $('#aNb').textContent = db.articles.length;
    $('#aOut').textContent = db.articles.filter(a => tracked(a) && stockLeft(a) <= 0).length;
    $('#aVal').textContent = money(db.articles.reduce((s, a) => s + (tracked(a) ? Math.max(0, stockLeft(a)) * num(a.prix) : 0), 0));
    const sold = [...new Set(db.ventes.map(v => v.produit.trim()).filter(p => p && !findArticle(p)))];
    $('#importArticles').hidden = !sold.length;
    $('#importArticles').textContent = `Créer ${sold.length} article${sold.length > 1 ? 's' : ''} à partir de mes ventes`;
  }
  $('#aSearch').addEventListener('input', renderArticles);
  $('#articleList').addEventListener('click', e => { const li = e.target.closest('li[data-art]'); if (li) openArticle(li.dataset.art); });
  $('#importArticles').addEventListener('click', () => {
    const latest = {};
    [...db.ventes].sort((a, b) => (a.date + (a.heure || '')).localeCompare(b.date + (b.heure || ''))).forEach(v => { if (v.produit.trim()) latest[normName(v.produit)] = v; });
    let n = 0;
    Object.values(latest).forEach(v => { if (!findArticle(v.produit)) { db.articles.push({ id: uid(), nom: v.produit.trim(), prix: num(v.pu), achat: '', stock: '', cat: '' }); n++; } });
    save(); render(); toast(`${n} article${n > 1 ? 's' : ''} créé${n > 1 ? 's' : ''}`);
  });

  const aDlg = $('#artDlg'), aForm = $('#artForm');
  let editArt = null;
  function openArticle(id) {
    editArt = id ? db.articles.find(a => a.id === id) : null;
    const a = editArt || { nom: '', prix: '', achat: '', stock: '', cat: '' };
    const f = aForm.elements;
    $('#catsList').innerHTML = [...new Set(db.articles.map(x => x.cat).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('');
    f.nom.value = a.nom; f.prix.value = a.prix; f.achat.value = a.achat ?? '';
    f.stock.value = tracked(a) && editArt ? stockLeft(a) : (editArt ? '' : a.stock); f.cat.value = a.cat || '';
    $('#artDel').hidden = !editArt;
    $('#artInfo').textContent = editArt ? `${nf.format(soldQty(a))} vendu(s) au total. Pour réapprovisionner, augmentez le stock actuel.` : 'Le prix sera mis automatiquement dans la vente quand vous choisirez cet article.';
    aDlg.showModal();
  }
  aDlg.addEventListener('close', () => {
    const action = aDlg.returnValue; aDlg.returnValue = '';
    if (action === 'delete' && editArt) {
      if (!confirm(`Supprimer l'article « ${editArt.nom} » ? Les ventes déjà enregistrées sont conservées.`)) return;
      db.articles = db.articles.filter(a => a !== editArt);
      save(); render(); toast('Article supprimé'); return;
    }
    if (action !== 'save') return;
    const f = aForm.elements;
    const nom = f.nom.value.trim();
    const other = findArticle(nom);
    if (other && other !== editArt) { toast('Un article porte déjà ce nom'); return; }
    const data = { nom, prix: num(f.prix.value), achat: f.achat.value === '' ? '' : num(f.achat.value), cat: f.cat.value.trim() };
    const target = editArt || { id: uid() };
    Object.assign(target, data);
    // On saisit le stock actuel : on mémorise stock actuel + quantités déjà vendues
    target.stock = f.stock.value === '' ? '' : num(f.stock.value) + soldQty(target);
    if (!editArt) db.articles.push(target);
    save(); render(); toast(editArt ? 'Article modifié' : 'Article ajouté ✔');
  });

  // Sélection d'un article dans la vente
  const apDlg = $('#artPickDlg');
  function renderArtPick() {
    const q = normName($('#artPickSearch').value);
    const list = popularArticles().filter(a => !q || normName(a.nom).includes(q) || normName(a.cat).includes(q));
    $('#artPickList').innerHTML = list.map(a => articleItem(a, false)).join('');
    $('#artPickEmpty').hidden = list.length > 0;
    $('#artPickEmpty').textContent = db.articles.length ? 'Aucun article ne correspond.' : "Aucun article. Ajoutez vos articles dans l'onglet « Articles ».";
  }
  $('#btnPickArticle').addEventListener('click', () => { $('#artPickSearch').value = ''; renderArtPick(); apDlg.showModal(); $('#artPickSearch').focus(); });
  $('#artPickSearch').addEventListener('input', renderArtPick);
  $('#artPickClose').addEventListener('click', () => apDlg.close());
  $('#artPickList').addEventListener('click', e => {
    const li = e.target.closest('li[data-art]'); if (!li) return;
    apDlg.close(); selectArticle(db.articles.find(a => a.id === li.dataset.art));
  });

  function renderProfil() {
    const f = $('#profilForm');
    ['marque', 'responsable', 'contacts', 'reseaux', 'devise'].forEach(k => (f.elements[k].value = db.profile[k] || ''));
    $('#licInfo').innerHTML = lic
      ? `Boutique : <b>${esc(lic.boutique || '—')}</b><br>Clé : ${esc(maskKey(lic.key))}<br>
         Valable ${lic.expire ? `jusqu'au <b>${dayFmt.format(parseIso(lic.expire))}</b>` : '<b>sans limite de durée</b>'}<br>
         Dernière vérification : ${lic.lastCheck ? new Date(lic.lastCheck).toLocaleString('fr-FR') : '—'}`
      : 'Aucune licence active.';
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
    const cl = buildClients();
    $('#clientsList').innerHTML = uniq(cl.map(c => c.name)).map(c => `<option value="${esc(c)}">`).join('');
    $('#telsList').innerHTML = cl.filter(c => c.tel).map(c => `<option value="${esc(c.tel)}">${esc(c.name)}</option>`).join('');
    const arts = [...db.articles].sort(byName);
    const others = uniq(db.ventes.map(v => v.produit)).filter(p => !findArticle(p));
    $('#produitsList').innerHTML = arts.map(a => `<option value="${esc(a.nom)}">${esc(money(num(a.prix)))}</option>`).join('')
      + others.map(c => `<option value="${esc(c)}">`).join('');
    // Raccourcis : les 6 articles les plus vendus
    $('#quickArticles').innerHTML = popularArticles().slice(0, 6)
      .map(a => `<button type="button" data-art="${a.id}">${esc(a.nom)} <b>${esc(nf.format(num(a.prix)))}</b></button>`).join('');
  }

  function prodHint(a) {
    const h = $('#prodHint');
    if (!a) { h.hidden = true; return; }
    const s = stockLeft(a);
    h.hidden = false;
    h.innerHTML = `Article : ${esc(a.nom)} · ${money(num(a.prix))}${s === null ? '' : ` · ${s <= 0 ? '<span class="stock-low">rupture de stock</span>' : `stock restant ${nf.format(s)}`}`}`;
  }
  // Choisir un article remplit le produit et le prix
  function selectArticle(a) {
    if (!a) return;
    const f = vForm.elements;
    f.produit.value = a.nom; f.pu.value = a.prix; f.pu.dataset.auto = '1';
    updateTotal(); prodHint(a);
    f.qte.focus();
  }
  $('#quickArticles').addEventListener('click', e => {
    const b = e.target.closest('[data-art]'); if (b) selectArticle(db.articles.find(a => a.id === b.dataset.art));
  });

  // Message sous les champs client
  function setHint(text, isNew) {
    const h = $('#clientHint');
    h.hidden = !text; h.textContent = text || ''; h.classList.toggle('new', !!isNew);
  }
  function hintFor(c) {
    setHint(`✔ Client reconnu : ${c.name || c.tel} · ${c.n} achat${c.n > 1 ? 's' : ''} · ${money(c.total)}${c.reste > 0 ? ` · doit ${money(c.reste)}` : ''}`);
  }
  function applyClient(c) {
    vForm.elements.client.value = c.name || '';
    vForm.elements.tel.value = c.tel || '';
    hintFor(c);
  }

  $('#btnOrdinaire').addEventListener('click', () => {
    vForm.elements.client.value = ORD;
    vForm.elements.tel.value = '';
    setHint('Vente sans fiche client', true);
    vForm.elements.produit.focus();
  });

  // Choisir un client existant
  const pDlg = $('#pickDlg');
  function renderPick() {
    const q = $('#pickSearch').value.trim();
    const list = buildClients().filter(c => matchClient(c, q)).sort((a, b) => b.last.localeCompare(a.last));
    $('#pickList').innerHTML = list.map(c => clientItem(c, false)).join('');
    $('#pickEmpty').hidden = list.length > 0;
  }
  $('#btnPickClient').addEventListener('click', () => {
    $('#pickSearch').value = ''; renderPick(); pDlg.showModal(); $('#pickSearch').focus();
  });
  $('#pickSearch').addEventListener('input', renderPick);
  $('#pickClose').addEventListener('click', () => pDlg.close());
  $('#pickList').addEventListener('click', e => {
    const li = e.target.closest('li[data-key]'); if (!li) return;
    const c = buildClients().find(x => x.key === li.dataset.key);
    pDlg.close();
    if (c) { applyClient(c); vForm.elements.produit.focus(); }
  });

  // Taper le numéro retrouve le client
  vForm.elements.tel.addEventListener('input', () => {
    const f = vForm.elements;
    if (normTel(f.tel.value).length < 8) { setHint(''); return; }
    const c = findByTel(f.tel.value);
    if (c) {
      if (!f.client.value.trim() || normName(f.client.value) === normName(ORD) || f.client.dataset.auto === '1') {
        f.client.value = c.name; f.client.dataset.auto = '1';
      }
      hintFor(c);
    } else {
      if (f.client.dataset.auto === '1') { f.client.value = ''; f.client.dataset.auto = ''; }
      setHint('Nouveau client : saisissez son nom', true);
    }
  });
  function updateTotal() {
    const t = num(vForm.elements.qte.value) * num(vForm.elements.pu.value);
    vForm.elements.total.value = money(t);
    const credit = vForm.elements.paiement.value === 'Crédit';
    $('.avance', vForm).hidden = !credit;
  }
  ['qte', 'pu', 'paiement'].forEach(n => vForm.elements[n].addEventListener('input', updateTotal));

  // Pré-remplir le numéro et le dernier prix connus
  vForm.elements.client.addEventListener('input', () => { vForm.elements.client.dataset.auto = ''; });
  vForm.elements.client.addEventListener('change', () => {
    const n = normName(vForm.elements.client.value);
    if (!n || n === normName(ORD)) return;
    const c = buildClients().find(x => normName(x.name) === n);
    if (c) { if (!vForm.elements.tel.value) vForm.elements.tel.value = c.tel; hintFor(c); }
  });
  // Produit reconnu : article du catalogue -> son prix ; sinon le dernier prix pratiqué
  vForm.elements.produit.addEventListener('input', () => {
    const f = vForm.elements;
    const a = findArticle(f.produit.value);
    if (a) { f.pu.value = a.prix; f.pu.dataset.auto = '1'; updateTotal(); prodHint(a); return; }
    prodHint(null);
    if (f.pu.dataset.auto === '1') { f.pu.value = ''; f.pu.dataset.auto = ''; updateTotal(); }
    const p = normName(f.produit.value);
    const last = p && [...db.ventes].reverse().find(v => normName(v.produit) === p);
    if (last && !f.pu.value) { f.pu.value = last.pu; f.pu.dataset.auto = '1'; updateTotal(); }
  });
  vForm.elements.pu.addEventListener('input', () => { vForm.elements.pu.dataset.auto = ''; });
  // Toucher un champ chiffré sélectionne son contenu : on tape pour remplacer
  ['qte', 'pu', 'avance'].forEach(n => vForm.elements[n].addEventListener('focus', e => e.target.select()));

  function openVente(id, preset) {
    fillDatalists();
    setHint('');
    vForm.elements.client.dataset.auto = '';
    vForm.elements.pu.dataset.auto = '';
    editVente = id ? db.ventes.find(v => v.id === id) : null;
    const v = editVente || {
      date: curDay, heure: curDay === today() ? `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}` : '',
      qte: 1, paiement: 'Espèces', remise: 'Sur place', ...(preset || {})
    };
    const f = vForm.elements;
    f.date.value = v.date; f.heure.value = v.heure || ''; f.client.value = v.client || ''; f.tel.value = v.tel || '';
    f.produit.value = v.produit || ''; f.qte.value = v.qte ?? 1; f.pu.value = v.pu ?? '';
    f.paiement.value = v.paiement || 'Espèces'; f.remise.value = v.remise || 'Sur place';
    f.avance.value = v.paiement === 'Crédit' ? (v.paye || 0) : 0; f.obs.value = v.obs || '';
    $('#venteDel').hidden = !editVente;
    updateTotal();
    prodHint(editVente ? (editVente.articleId ? db.articles.find(a => a.id === editVente.articleId) : findArticle(editVente.produit)) : null);
    vDlg.showModal();
    if (preset && preset.client) { const c = buildClients().find(x => normName(x.name) === normName(preset.client)); if (c) hintFor(c); f.produit.focus(); }
    else if (!editVente) f.tel.focus();
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
    const art = findArticle(data.produit);
    data.articleId = art ? art.id : '';
    if (art && tracked(art)) {
      const dispo = stockLeft(art) + (editVente && isOfArticle(editVente, art) ? num(editVente.qte) : 0);
      if (data.qte > dispo) setTimeout(() => toast(`Attention : stock de « ${art.nom} » insuffisant (${nf.format(dispo)})`), 2300);
    }
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

  $('#fab').addEventListener('click', () => (curView === 'depenses' ? openDep() : curView === 'articles' ? openArticle() : openVente()));

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
      if (!confirm(`Remplacer les données actuelles par cette sauvegarde (${d.ventes.length} ventes, ${d.depenses.length} dépenses, ${(d.articles || []).length} articles) ?`)) return;
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

  // ---------- Licence ----------
  // Les licences sont dans un fichier licences.json sur GitHub (voir config.js).
  // Chaque licence y est enregistrée par l'empreinte SHA-256 de sa clé : la clé elle-même n'est jamais publiée.
  const CFG = Object.assign({ licenceUrl: '', horsLigneMaxJours: 30, alerteJours: 7, verifHeures: 6 }, window.CARNET_CONFIG || {});
  const LIC_KEY = 'carnet-licence-v1', VENDOR_KEY = 'carnet-vendeur-v1';
  const readJSON = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const writeJSON = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  let lic = readJSON(LIC_KEY);
  const normKey = k => String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const maskKey = k => { const n = normKey(k); return n.length > 8 ? `${n.slice(0, 6)}-••••-${n.slice(-4)}` : '••••'; };
  async function sha256(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  async function fetchLicences() {
    if (!CFG.licenceUrl) throw new Error('config');
    const r = await fetch(CFG.licenceUrl + (CFG.licenceUrl.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('http ' + r.status);
    const data = await r.json();
    if (data.vendeur) writeJSON(VENDOR_KEY, data.vendeur);
    return data;
  }
  const statusOf = e => !e ? 'inconnue' : e.actif === false ? 'suspendue' : (e.expire && e.expire < today()) ? 'expiree' : 'ok';
  const lockMessages = {
    inconnue: "Cette clé de licence n'est pas reconnue.",
    suspendue: 'Cette licence a été suspendue.',
    expiree: 'Votre licence a expiré. Contactez-nous pour la renouveler.',
    horsligne: 'Connectez-vous à internet pour vérifier votre licence.',
    reseau: "Pas de connexion internet : l'activation nécessite internet.",
  };

  function renderVendor() {
    const v = readJSON(VENDOR_KEY) || {};
    const tel = String(v.telephone || '').replace(/[^\d+]/g, '');
    const wa = String(v.whatsapp || v.telephone || '').replace(/\D/g, '');
    $('#lockContact').innerHTML = (v.nom || tel || v.message) ? `
      ${esc(v.message || 'Pour obtenir ou renouveler une licence, contactez :')}
      ${v.nom ? `<div><b>${esc(v.nom)}</b></div>` : ''}
      ${tel ? `<div class="cd-contact"><a class="btn small ghost" href="tel:${esc(tel)}">📞 ${esc(v.telephone)}</a>
        ${wa ? `<a class="btn small ghost" href="https://wa.me/${esc(wa)}?text=${encodeURIComponent('Bonjour, je souhaite une licence pour le Carnet de gestion des ventes.')}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}</div>` : ''}` : '';
  }
  function lock(msg, err) {
    document.body.classList.add('locked');
    $('#lock').hidden = false;
    $('#lockMsg').textContent = msg || "Entrez votre clé de licence pour activer l'application.";
    $('#lockErr').hidden = !err; $('#lockErr').textContent = err || '';
    if (lic && lic.key) $('#lockForm').elements.key.value = lic.key;
    $('#lockBtn').textContent = lic ? 'Réessayer' : 'Activer';
    renderVendor();
    [vDlg, dDlg, aDlg, apDlg, pDlg, cDlg].forEach(d => d.open && d.close());
  }
  let started = false;
  function unlock() {
    document.body.classList.remove('locked');
    $('#lock').hidden = true;
    const b = $('#licBanner');
    const left = lic && lic.expire ? Math.ceil((parseIso(lic.expire) - parseIso(today())) / 864e5) : null;
    b.hidden = !(left !== null && left <= CFG.alerteJours);
    if (!b.hidden) b.textContent = left <= 0 ? "Votre licence expire aujourd'hui." : `Votre licence expire dans ${left} jour${left > 1 ? 's' : ''} (le ${dayFmt.format(parseIso(lic.expire))}).`;
    if (!started) { started = true; show('ventes'); } else render();
  }
  // Vérification en ligne de la licence enregistrée
  async function verifyOnline() {
    if (!lic) return;
    try {
      const data = await fetchLicences();
      const e = (data.licences || []).find(x => x.hash === lic.hash);
      const st = statusOf(e);
      if (st === 'ok') {
        lic = { ...lic, expire: e.expire || '', boutique: e.boutique || lic.boutique, lastCheck: Date.now() };
        writeJSON(LIC_KEY, lic); unlock();
      } else lock(lockMessages[st]);
      return st;
    } catch { return 'reseau'; }
  }
  async function bootLicence() {
    if (!lic) return lock();
    // Décision immédiate avec la dernière vérification connue (fonctionne hors connexion)
    const days = (Date.now() - (lic.lastCheck || 0)) / 864e5;
    if (lic.expire && lic.expire < today()) lock(lockMessages.expiree);
    else if (days > CFG.horsLigneMaxJours) lock(lockMessages.horsligne);
    else unlock();
    verifyOnline();
  }
  $('#lockForm').addEventListener('submit', async e => {
    e.preventDefault();
    const key = normKey(e.target.elements.key.value);
    const btn = $('#lockBtn'); btn.disabled = true; btn.textContent = 'Vérification…';
    $('#lockErr').hidden = true;
    try {
      const hash = await sha256(key);
      let data;
      try { data = await fetchLicences(); } catch (err) {
        lock($('#lockMsg').textContent, /^(http|config)/.test(err.message) ? 'Le service de licences est momentanément indisponible. Réessayez plus tard.' : lockMessages.reseau);
        return;
      }
      const entry = (data.licences || []).find(x => x.hash === hash);
      const st = statusOf(entry);
      if (st !== 'ok') { lock($('#lockMsg').textContent, lockMessages[st]); return; }
      const first = !lic;
      lic = { key: e.target.elements.key.value.trim().toUpperCase(), hash, boutique: entry.boutique || '', telephone: entry.telephone || '', expire: entry.expire || '', lastCheck: Date.now() };
      writeJSON(LIC_KEY, lic);
      // Pré-remplit le profil avec les informations de la boutique
      if (!db.profile.marque && entry.boutique) db.profile.marque = entry.boutique;
      if (!db.profile.contacts && entry.telephone) db.profile.contacts = entry.telephone;
      save();
      unlock();
      toast(first ? `Licence activée : bienvenue ${entry.boutique || ''} !` : 'Licence vérifiée ✔');
    } finally { btn.disabled = false; btn.textContent = lic ? 'Réessayer' : 'Activer'; }
  });
  $('#licCheck').addEventListener('click', async () => {
    const st = await verifyOnline();
    if (st === 'ok') { renderProfil(); toast('Licence valide ✔'); }
    else if (st === 'reseau') toast('Pas de connexion internet');
  });
  $('#licChange').addEventListener('click', () => {
    if (!confirm('Saisir une autre clé de licence ? Vos données ne seront pas effacées.')) return;
    lic = null; writeJSON(LIC_KEY, null); $('#lockForm').elements.key.value = ''; lock();
  });
  // Revérifie quand on revient sur l'application
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && lic && Date.now() - (lic.lastCheck || 0) > CFG.verifHeures * 36e5) verifyOnline();
  });

  bootLicence();
})();
