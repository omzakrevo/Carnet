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
  // Seuil d'alerte de stock bas (3 par défaut)
  const seuil = a => (a.alerte === '' || a.alerte == null) ? 3 : num(a.alerte);
  // État du stock : none (non suivi), out (épuisé), low (bas), ok
  function stockState(a) {
    const s = stockLeft(a);
    return s === null ? 'none' : s <= 0 ? 'out' : s <= seuil(a) ? 'low' : 'ok';
  }
  function stockText(a) {
    const s = stockLeft(a), st = stockState(a);
    if (st === 'none') return 'Stock non suivi';
    return st === 'out' ? '<span class="stock-low">Rupture de stock</span>' : `${st === 'low' ? '<span class="stock-low">Stock bas : ' : '<span>Stock : '}${nf.format(s)}</span>`;
  }
  function stockBadge(a) {
    const s = stockLeft(a), st = stockState(a);
    const txt = st === 'none' ? 'non suivi' : st === 'out' ? 'Épuisé' : `Reste ${nf.format(s)}`;
    return `<span class="stock-badge ${st}">${txt}</span>`;
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
      <div class="side"><b>${money(num(a.prix))}</b>${stockBadge(a)}</div>
    </li>`;
  }
  let artFilter = 'tous';
  function renderArticles() {
    const q = normName($('#aSearch').value);
    const nBas = db.articles.filter(a => stockState(a) === 'low').length, nOut = db.articles.filter(a => stockState(a) === 'out').length;
    $$('#aFilters button').forEach(b => {
      b.classList.toggle('active', b.dataset.f === artFilter);
      b.textContent = { tous: `Tous (${db.articles.length})`, bas: `Stock bas (${nBas})`, rupture: `Rupture (${nOut})` }[b.dataset.f];
    });
    const list = [...db.articles].sort(byName)
      .filter(a => !q || normName(a.nom).includes(q) || normName(a.cat).includes(q))
      .filter(a => artFilter === 'tous' || (artFilter === 'bas' ? stockState(a) === 'low' : stockState(a) === 'out'));
    $('#articleList').innerHTML = list.map(a => articleItem(a, true)).join('');
    $('#articleEmpty').hidden = list.length > 0;
    $('#articleEmpty').innerHTML = db.articles.length ? 'Aucun article ne correspond.' : 'Aucun article. Touchez <b>+</b> pour ajouter les articles de votre boutique.';
    $('#aNb').textContent = db.articles.length;
    $('#aOut').textContent = nBas + nOut;
    $('#aVal').textContent = money(db.articles.reduce((s, a) => s + (tracked(a) ? Math.max(0, stockLeft(a)) * num(a.prix) : 0), 0));
    const sold = [...new Set(db.ventes.map(v => v.produit.trim()).filter(p => p && !findArticle(p)))];
    $('#importArticles').hidden = !sold.length;
    $('#importArticles').textContent = `Créer ${sold.length} article${sold.length > 1 ? 's' : ''} à partir de mes ventes`;
  }
  $('#aSearch').addEventListener('input', renderArticles);
  $('#articleList').addEventListener('click', e => { const li = e.target.closest('li[data-art]'); if (li) openArtView(li.dataset.art); });
  $$('#aFilters button').forEach(b => b.addEventListener('click', () => { artFilter = b.dataset.f; renderArticles(); }));

  // ---------- Suivi du stock d'un article ----------
  const avDlg = $('#artViewDlg');
  let viewArt = null;
  const mv = (a, m) => { a.mouvements = [...(a.mouvements || []), { date: today(), at: Date.now(), ...m }]; };
  function renderArtView() {
    const a = viewArt; if (!a) return;
    const s = stockLeft(a), st = stockState(a);
    $('#avName').textContent = a.nom;
    const box = $('#avStock'); box.className = 'stock-big ' + st;
    box.innerHTML = st === 'none'
      ? `<b>Stock non suivi</b><span>Indiquez la quantité reçue ci-dessous pour commencer à suivre le stock.</span>`
      : `<b>${nf.format(Math.max(0, s))}</b><span>${st === 'out' ? 'épuisé : pensez à réapprovisionner' : st === 'low' ? `en stock : stock bas (alerte à ${nf.format(seuil(a))})` : 'en stock'}</span>`;
    const recu = (a.mouvements || []).filter(m => m.type === 'entree').reduce((t, m) => t + num(m.qte), 0);
    const moisQ = db.ventes.filter(v => v.date.startsWith(today().slice(0, 7)) && isOfArticle(v, a)).reduce((t, v) => t + num(v.qte), 0);
    $('#avStats').innerHTML = `
      <div class="stat"><span>Prix de vente</span><strong>${money(num(a.prix))}</strong></div>
      <div class="stat"><span>Vendus au total</span><strong>${nf.format(soldQty(a))}</strong></div>
      <div class="stat"><span>Vendus ce mois</span><strong>${nf.format(moisQ)}</strong></div>
      <div class="stat accent"><span>Valeur en stock</span><strong>${money(Math.max(0, s || 0) * num(a.prix))}</strong></div>`;
    const hasAchat = a.achat !== '' && a.achat != null && num(a.achat) > 0;
    $('#avDepRow').hidden = !hasAchat;
    const q = num($('#avQte').value);
    $('#avDepLabel').textContent = `Enregistrer l'achat dans les dépenses${q > 0 && hasAchat ? ` (${money(q * num(a.achat))})` : ''}`;
    $('#avInv').hidden = st === 'none';
    // Historique : entrées, inventaires et ventes
    const items = [
      ...(a.mouvements || []).map(m => ({ k: m.date + (m.at || ''), date: m.date,
        html: m.type === 'entree' ? `<span class="plus">+${nf.format(num(m.qte))}</span> ${esc(m.note || 'Réapprovisionnement')}`
          : `<b>= ${nf.format(num(m.qte))}</b> Inventaire${m.ecart ? ` (écart ${m.ecart > 0 ? '+' : ''}${nf.format(m.ecart)})` : ''}` })),
      ...db.ventes.filter(v => isOfArticle(v, a)).map(v => ({ k: v.date + (v.createdAt || ''), date: v.date,
        html: `<span class="minus">−${nf.format(num(v.qte))}</span> Vente${v.client ? ` · ${esc(v.client)}` : ''}` })),
    ].sort((x, y) => String(y.k).localeCompare(String(x.k))).slice(0, 40);
    $('#avHist').innerHTML = items.length ? items.map(i => `<li><div>${i.html}</div><span class="muted">${shortFmt.format(parseIso(i.date))}</span></li>`).join('')
      : '<li class="muted">Aucun mouvement pour l\'instant.</li>';
  }
  function openArtView(id) {
    viewArt = db.articles.find(a => a.id === id); if (!viewArt) return;
    $('#avQte').value = ''; $('#avDep').checked = false;
    renderArtView(); avDlg.showModal();
  }
  $('#avQte').addEventListener('input', renderArtView);
  $('#avAdd').addEventListener('click', () => {
    const a = viewArt, q = num($('#avQte').value);
    if (!(q > 0)) { toast('Indiquez la quantité reçue'); $('#avQte').focus(); return; }
    // Si le stock n'était pas suivi, on part de zéro
    a.stock = (tracked(a) ? num(a.stock) : soldQty(a)) + q;
    mv(a, { type: 'entree', qte: q, note: 'Réapprovisionnement' });
    if ($('#avDep').checked && !$('#avDepRow').hidden) {
      db.depenses.push({ id: uid(), date: today(), libelle: `Achat de stock : ${a.nom} (× ${nf.format(q)})`, categorie: 'Achat de stock', montant: q * num(a.achat), paiement: 'Espèces' });
    }
    save(); $('#avQte').value = ''; $('#avDep').checked = false; renderArtView(); render();
    toast(`+${nf.format(q)} ${a.nom} : reste ${nf.format(stockLeft(a))}`);
  });
  $('#avInv').addEventListener('click', () => {
    const a = viewArt, avant = stockLeft(a);
    const ans = prompt(`Combien de « ${a.nom} » avez-vous réellement en boutique ?`, String(Math.max(0, avant)));
    if (ans === null || ans.trim() === '') return;
    const n = Math.max(0, num(ans));
    a.stock = n + soldQty(a);
    mv(a, { type: 'inventaire', qte: n, ecart: n - avant });
    save(); renderArtView(); render(); toast(`Stock corrigé : ${nf.format(n)}`);
  });
  $('#avClose').addEventListener('click', () => avDlg.close());
  $('#avEdit').addEventListener('click', () => { const id = viewArt.id; avDlg.close(); openArticle(id); });
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
    f.alerte.value = a.alerte ?? '';
    $('#artStockLabel').textContent = editArt ? 'Stock actuel' : 'Quantité en stock';
    $('#artDel').hidden = !editArt;
    $('#artInfo').textContent = editArt ? `${nf.format(soldQty(a))} vendu(s) au total. Pour un arrivage, utilisez plutôt « + Ajouter au stock » dans la fiche de l'article.` : 'Le prix sera mis automatiquement dans la vente quand vous choisirez cet article, et le stock baissera à chaque vente.';
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
    data.alerte = f.alerte.value === '' ? '' : num(f.alerte.value);
    const target = editArt || { id: uid() };
    Object.assign(target, data);
    // On saisit le stock actuel : on mémorise stock actuel + quantités déjà vendues
    const avant = tracked(target) ? stockLeft(target) : null;
    target.stock = f.stock.value === '' ? '' : num(f.stock.value) + soldQty(target);
    if (f.stock.value !== '') {
      const n = num(f.stock.value);
      if (!editArt || avant === null) mv(target, { type: 'entree', qte: n, note: 'Stock de départ' });
      else if (n !== avant) mv(target, { type: 'inventaire', qte: n, ecart: n - avant });
    }
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
      ? `Boutique : <b>${esc(lic.boutique || '—')}</b><br>Clé : <b style="font-family:ui-monospace,monospace">${esc(lic.key || maskKey(''))}</b><br>
         Valable ${lic.expire ? `jusqu'au <b>${dayFmt.format(parseIso(lic.expire))}</b>` : '<b>sans limite de durée</b>'}<br>
         Dernière vérification : ${lic.lastCheck ? new Date(lic.lastCheck).toLocaleString('fr-FR') : '—'}`
      : trialActive()
        ? `<b>Essai gratuit</b> jusqu'au ${new Date(trialEnd()).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })} (encore ${leftText(trialEnd() - Date.now())}).`
        : 'Aucune licence active.';
    const c = acc && acc.compte;
    $('#accInfo').innerHTML = c ? `<b>${esc(c.prenom)} ${esc(c.nom)}</b><br>${esc(c.boutique)}<br>${esc(c.telephone)}${c.cree ? `<br>Inscrit le ${dayFmt.format(new Date(c.cree))}` : ''}` : '';
    $('#licRenew').textContent = lic ? 'Prolonger mon abonnement' : `M'abonner (${money(CFG.prixMois)} / mois)`;
    $('#licCopy').hidden = !lic;
    $('#licChange').textContent = lic ? 'Changer de clé de licence' : "J'ai une clé de licence";
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
      .map(a => { const s = stockLeft(a); return `<button type="button" data-art="${a.id}">${esc(a.nom)} <b>${esc(nf.format(num(a.prix)))}</b>${s === null ? '' : ` <small class="${s <= seuil(a) ? 'stock-low' : 'muted'}">(${s <= 0 ? 'épuisé' : 'reste ' + nf.format(s)})</small>`}</button>`; }).join('');
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
  const CFG = Object.assign({ licenceUrl: '', horsLigneMaxJours: 30, alerteJours: 7, verifHeures: 6, paiementActif: false, prixMois: 1000 }, window.CARNET_CONFIG || {});
  CFG.essaiHeures = Number(CFG.essaiHeures ?? 24);
  // ---------- Compte et essai gratuit ----------
  // L'essai gratuit commence à l'inscription et il est enregistré dans le compte (serveur) : il ne peut pas être relancé.
  const ACC_KEY = 'carnet-compte-v1';
  let acc = null;
  const trialEnd = () => (acc && acc.compte && acc.compte.essaiFin) || 0;
  const trialStart = trialEnd;
  const trialActive = () => !lic && Date.now() < trialEnd();
  const trialOver = () => !lic && trialEnd() > 0 && Date.now() >= trialEnd();
  function leftText(ms) {
    const tot = Math.max(1, Math.ceil(ms / 6e4)), h = Math.floor(tot / 60), m = tot % 60;
    return h ? `${h} h${m ? ' ' + String(m).padStart(2, '0') + ' min' : ''}` : `${m} min`;
  }
  const GRACE_MS = 20 * 60e3; // juste après un paiement, GitHub peut mettre quelques minutes à publier la licence
  const PAY_KEY = 'carnet-paiement-v1', REF_KEY = 'carnet-parrain';

  // Lien de parrainage : ?ref=CODE (le premier parrain est conservé)
  const params = new URLSearchParams(location.search);
  const refParam = (params.get('ref') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  try { if (refParam && !localStorage.getItem(REF_KEY)) localStorage.setItem(REF_KEY, refParam); } catch {}
  const retourPaiement = params.get('paiement') === 'retour';
  if (refParam || retourPaiement) history.replaceState(null, '', location.pathname);
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
    $('#auth').hidden = true;
    // Pendant l'essai, on peut revenir à l'application depuis l'écran de clé
    $('#lockTrial').hidden = !trialActive();
    $('#lockTrial').textContent = `Continuer l'essai gratuit (encore ${leftText(trialEnd() - Date.now())})`;
    if (trialOver() && !msg) $('#lockMsg').textContent = `Votre essai gratuit de ${CFG.essaiHeures} heures est terminé. Abonnez-vous pour continuer : vos données sont conservées.`;
    renderVendor();
    closeDialogs();
  }
  const closeDialogs = () => [vDlg, dDlg, aDlg, apDlg, pDlg, cDlg, avDlg].forEach(d => d.open && d.close());
  let started = false;
  function unlock() {
    document.body.classList.remove('locked');
    $('#lock').hidden = true;
    renderBanner();
    if (!started) { started = true; show('ventes'); } else render();
  }
  function renderBanner() {
    const b = $('#licBanner');
    if (trialActive()) {
      b.hidden = false;
      b.textContent = `Essai gratuit : encore ${leftText(trialEnd() - Date.now())}.${CFG.paiementActif ? ` Touchez ici pour vous abonner (${money(CFG.prixMois)} / mois).` : ''}`;
      return;
    }
    const left = lic && lic.expire ? Math.ceil((parseIso(lic.expire) - parseIso(today())) / 864e5) : null;
    b.hidden = !(left !== null && left <= CFG.alerteJours);
    if (!b.hidden) b.textContent = left <= 0 ? "Votre licence expire aujourd'hui." : `Votre licence expire dans ${left} jour${left > 1 ? 's' : ''} (le ${dayFmt.format(parseIso(lic.expire))}).`;
  }
  // Pendant l'essai : mise à jour du compte à rebours, blocage à la fin
  setInterval(() => {
    if (lic || !trialStart() || document.body.classList.contains('locked')) return;
    if (trialOver()) lock(); else renderBanner();
  }, 30e3);
  $('#lockTrial').addEventListener('click', () => { if (trialActive()) unlock(); });

  // Vérification en ligne de la licence enregistrée
  async function verifyOnline() {
    if (!lic) return;
    try {
      const data = await fetchLicences();
      const e = (data.licences || []).find(x => x.hash === lic.hash);
      const st = statusOf(e);
      // Paiement tout récent : le fichier GitHub n'est peut-être pas encore à jour, on garde la licence reçue du serveur
      if (lic.grace && Date.now() - lic.grace < GRACE_MS && (st !== 'ok' || (lic.expire && e.expire && e.expire < lic.expire))) { unlock(); return 'ok'; }
      if (st === 'ok') {
        lic = { ...lic, expire: e.expire || '', boutique: e.boutique || lic.boutique, lastCheck: Date.now() };
        writeJSON(LIC_KEY, lic); unlock();
      } else lock(lockMessages[st]);
      return st;
    } catch { return 'reseau'; }
  }
  async function bootLicence() {
    $('#lockPayBox').hidden = !CFG.paiementActif;
    $('#lockPrice').textContent = money(CFG.prixMois);
    $('#licRenew').hidden = !CFG.paiementActif;
    // Retour de la page de paiement (ou paiement resté en attente) : on le confirme d'abord
    if (readJSON(PAY_KEY)) { if (!lic) { if (trialActive()) unlock(); else lock(); } confirmPayment(true); if (!lic) return; }
    if (!lic) return trialActive() ? unlock() : lock();
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
      if (acc) api('lier', { cle: lic.key }).then(j => { acc.compte = j.compte; writeJSON(ACC_KEY, acc); }).catch(() => {});
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
    if (lic && !confirm('Saisir une autre clé de licence ? Vos données ne seront pas effacées.')) return;
    lic = null; writeJSON(LIC_KEY, null); $('#lockForm').elements.key.value = ''; lock();
  });
  $('#licCopy').addEventListener('click', async () => {
    if (!lic) return;
    try { await navigator.clipboard.writeText(lic.key); toast('Clé copiée ✔'); } catch { toast(lic.key); }
  });

  // ---------- Paiement de l'abonnement (SasPay) ----------
  const payDlg = $('#payDlg'), payForm = $('#payForm'), psDlg = $('#payStatusDlg');
  function payTotal() { $('#payTotal').textContent = money(CFG.prixMois * Number(payForm.elements.mois.value)); }
  payForm.elements.mois.addEventListener('change', payTotal);
  function openPay(renew) {
    const f = payForm.elements;
    payForm.classList.toggle('renew', !!renew || !!acc); // avec un compte, la boutique et le parrain sont déjà connus
    payForm.dataset.renew = renew ? '1' : '';
    $('#payTitle').textContent = renew ? 'Prolonger mon abonnement' : `Abonnement ${money(CFG.prixMois)} / mois`;
    f.boutique.value = db.profile.marque || '';
    f.boutique.required = !renew && !acc;
    f.telephone.value = acc ? acc.compte.telephone : (db.profile.contacts || '').match(/[+\d][\d\s.-]{6,}/)?.[0]?.trim() || '';
    try { f.parrain.value = localStorage.getItem(REF_KEY) || ''; } catch { f.parrain.value = ''; }
    f.mois.value = '1'; payTotal();
    $('#payErr').hidden = true;
    payDlg.showModal();
  }
  $('#lockPay').addEventListener('click', () => openPay(false));
  $('#licRenew').addEventListener('click', () => openPay(!!lic));
  $('#licBanner').addEventListener('click', () => { if (CFG.paiementActif) openPay(!!lic); });
  payForm.addEventListener('submit', async e => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    const f = payForm.elements, renew = payForm.dataset.renew === '1';
    const btn = $('#payBtn'); btn.disabled = true; btn.textContent = 'Connexion à SasPay…';
    $('#payErr').hidden = true;
    try {
      const r = await fetch('/api/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boutique: f.boutique.value.trim(), telephone: f.telephone.value.trim(), email: f.email.value.trim(),
          mois: Number(f.mois.value), parrain: renew ? '' : f.parrain.value.trim(), renouveler: renew && lic ? lic.hash : '',
          token: acc ? acc.token : '',
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.checkout_url) throw new Error(j.error || 'Le paiement est momentanément indisponible.');
      if (!db.profile.marque && f.boutique.value.trim()) db.profile.marque = f.boutique.value.trim();
      if (!db.profile.contacts && f.telephone.value.trim()) db.profile.contacts = f.telephone.value.trim();
      save();
      writeJSON(PAY_KEY, { commande: j.commande, renew, at: Date.now() });
      location.href = j.checkout_url; // page de paiement SasPay
    } catch (err) {
      $('#payErr').textContent = err.message === 'Failed to fetch' ? lockMessages.reseau.replace("l'activation", 'le paiement') : err.message;
      $('#payErr').hidden = false;
      btn.disabled = false; btn.textContent = 'Payer';
    }
  });

  function payStatus(title, html, actions) {
    $('#psTitle').textContent = title;
    $('#psBody').innerHTML = html;
    $('#psActions').innerHTML = '';
    actions.forEach(([label, fn, ghost]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn' + (ghost ? ' ghost' : ''); b.textContent = label;
      b.addEventListener('click', fn); $('#psActions').appendChild(b);
    });
    if (!psDlg.open) psDlg.showModal();
  }
  let pollT = null, pollN = 0;
  async function confirmPayment(first) {
    const p = readJSON(PAY_KEY); if (!p) return;
    clearTimeout(pollT);
    if (first) pollN = 0;
    payStatus('Vérification du paiement…', '<div class="spinner"></div>Nous vérifions votre paiement auprès de SasPay.', []);
    let j;
    try {
      const r = await fetch('/api/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commande: p.commande }) });
      j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Erreur ' + r.status);
    } catch (err) {
      return payStatus('Vérification impossible', esc(err.message === 'Failed to fetch' ? 'Pas de connexion internet.' : err.message) + '<br>Votre paiement n\'est pas perdu : réessayez dans un instant.',
        [['Réessayer', () => confirmPayment(true)], ['Fermer', () => psDlg.close(), true]]);
    }
    if (j.statut === 'ok') {
      writeJSON(PAY_KEY, null);
      const L = j.licence;
      if (j.cle) lic = { key: j.cle, hash: L.hash, boutique: L.boutique, telephone: '', expire: L.expire, lastCheck: Date.now(), grace: Date.now() };
      else lic = { ...lic, expire: L.expire, lastCheck: Date.now(), grace: Date.now() };
      writeJSON(LIC_KEY, lic);
      if (!db.profile.marque && L.boutique) { db.profile.marque = L.boutique; save(); }
      unlock();
      const fin = L.expire ? `jusqu'au <b>${dayFmt.format(parseIso(L.expire))}</b>` : 'sans limite de durée';
      return payStatus('Paiement réussi ✔', j.cle
        ? `Votre abonnement est actif ${fin}.<br>Voici votre clé de licence : notez-la, elle sert à réinstaller l'application.<div class="keybox">${esc(j.cle)}</div>`
        : `Votre abonnement est prolongé ${fin}. Merci !`,
        [['Copier la clé', async () => { try { await navigator.clipboard.writeText(lic.key); toast('Clé copiée ✔'); } catch {} }, true], ['Commencer', () => psDlg.close()]].filter((a, i) => j.cle || i === 1));
    }
    if (j.statut === 'echec') {
      writeJSON(PAY_KEY, null);
      return payStatus('Paiement non abouti', 'Le paiement a été annulé ou a échoué. Aucun montant n\'a été validé.',
        [['Réessayer le paiement', () => { psDlg.close(); openPay(!!p.renew && !!lic); }], ['Fermer', () => psDlg.close(), true]]);
    }
    // En attente : le client valide encore sur son téléphone
    pollN++;
    if (pollN < 24) pollT = setTimeout(() => confirmPayment(false), 5000);
    payStatus('Paiement en attente…', '<div class="spinner"></div>Validez le paiement sur votre téléphone (Orange Money / Moov Money). Cette page se met à jour toute seule.',
      [['Vérifier maintenant', () => confirmPayment(false)], ['Abandonner', () => {
        if (!confirm('Abandonner ce paiement ? Si vous avez déjà payé, gardez-le en attente.')) return;
        clearTimeout(pollT); writeJSON(PAY_KEY, null); psDlg.close();
      }, true]]);
  }

  // Revérifie quand on revient sur l'application
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && lic && Date.now() - (lic.lastCheck || 0) > CFG.verifHeures * 36e5) verifyOnline();
  });

  // ---------- Inscription / connexion ----------
  async function api(action, data = {}) {
    const r = await fetch('/api/compte', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...data, token: acc ? acc.token : '' }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'Erreur ' + r.status); e.status = r.status; throw e; }
    return j;
  }
  const netMsg = err => err.message === 'Failed to fetch' ? 'Pas de connexion internet : la création du compte et la connexion nécessitent internet.' : err.message;
  function setAuthTab(t) {
    $$('.seg button').forEach(b => b.classList.toggle('active', b.dataset.auth === t));
    $('#regForm').hidden = t !== 'inscription';
    $('#loginForm').hidden = t !== 'connexion';
    $('#authErr').hidden = true;
  }
  $$('.seg button').forEach(b => b.addEventListener('click', () => setAuthTab(b.dataset.auth)));
  function showAuth(tab, err) {
    document.body.classList.add('locked');
    $('#lock').hidden = true; $('#auth').hidden = false;
    setAuthTab(tab || 'inscription');
    if (err) { $('#authErr').textContent = err; $('#authErr').hidden = false; }
    $('#regTrial').textContent = `${CFG.essaiHeures} heures`;
    try { $('#regForm').elements.parrain.value = localStorage.getItem(REF_KEY) || ''; } catch {}
    renderVendor(); $('#authContact').innerHTML = $('#lockContact').innerHTML;
    closeDialogs();
  }
  // Remplit le profil de la boutique avec les informations du compte
  function applyCompte() {
    const c = acc.compte;
    if (!db.profile.marque) db.profile.marque = c.boutique;
    if (!db.profile.responsable) db.profile.responsable = `${c.prenom} ${c.nom}`.trim();
    if (!db.profile.contacts) db.profile.contacts = c.telephone;
    save(); renderHeader();
  }
  // Le compte a une clé que ce téléphone n'a pas encore (connexion sur un nouveau téléphone)
  async function licFromCompte() {
    const c = acc && acc.compte;
    if (!c || !c.cle || lic) return false;
    lic = { key: c.cle, hash: await sha256(normKey(c.cle)), boutique: c.boutique, telephone: '', expire: '', lastCheck: Date.now() };
    writeJSON(LIC_KEY, lic);
    return true;
  }
  async function onAuth(j, welcome) {
    acc = { token: j.token, compte: j.compte };
    writeJSON(ACC_KEY, acc);
    applyCompte();
    $('#auth').hidden = true;
    await licFromCompte();
    await bootLicence();
    if (welcome) toast(welcome);
  }
  async function submitAuth(form, action, payload, welcome) {
    const btn = form.querySelector('button[type=submit]'), label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Patientez…'; $('#authErr').hidden = true;
    try { await onAuth(await api(action, payload), welcome); }
    catch (err) { $('#authErr').textContent = netMsg(err); $('#authErr').hidden = false; }
    finally { btn.disabled = false; btn.textContent = label; }
  }
  $('#regForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target.elements;
    submitAuth(e.target, 'inscription', {
      prenom: f.prenom.value, nom: f.nom.value, boutique: f.boutique.value, telephone: f.telephone.value,
      motdepasse: f.motdepasse.value, parrain: f.parrain.value, cle: lic ? lic.key : '',
    }, `Bienvenue ${f.prenom.value.trim()} ! Votre essai gratuit de ${CFG.essaiHeures} heures commence.`);
  });
  $('#loginForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target.elements;
    submitAuth(e.target, 'connexion', { telephone: f.telephone.value, motdepasse: f.motdepasse.value }, 'Connexion réussie ✔');
  });
  function logout(msg) {
    acc = null; writeJSON(ACC_KEY, null);
    lic = null; writeJSON(LIC_KEY, null);
    $('#licBanner').hidden = true;
    showAuth('connexion', msg);
  }
  // Met à jour le compte depuis le serveur (essai, clé payée sur un autre téléphone, compte suspendu…)
  async function refreshCompte() {
    if (!acc) return;
    try {
      const j = await api('moi');
      acc.compte = j.compte; writeJSON(ACC_KEY, acc);
      if (await licFromCompte()) await verifyOnline();
      else if (!lic) { if (trialActive()) unlock(); else lock(); }
    } catch (err) { if (err.status === 401 || err.status === 403) logout(err.message); }
  }
  $('#accLogout').addEventListener('click', () => {
    if (!confirm('Vous déconnecter ? Les données saisies restent sur ce téléphone.')) return;
    logout();
  });
  $('#lockLogout').addEventListener('click', () => logout());
  const pwdDlg = $('#pwdDlg'), pwdForm = $('#pwdForm');
  $('#accPwd').addEventListener('click', () => { pwdForm.reset(); $('#pwdErr').hidden = true; pwdDlg.showModal(); });
  pwdForm.addEventListener('submit', async e => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    try {
      await api('motdepasse', { ancien: pwdForm.elements.ancien.value, nouveau: pwdForm.elements.nouveau.value });
      pwdDlg.close(); toast('Mot de passe modifié ✔');
    } catch (err) { $('#pwdErr').textContent = err.message === 'Failed to fetch' ? 'Pas de connexion internet.' : err.message; $('#pwdErr').hidden = false; }
  });

  async function boot() {
    acc = readJSON(ACC_KEY);
    if (!acc || !acc.token) return showAuth('inscription');
    await licFromCompte();
    await bootLicence();
    refreshCompte();
  }
  boot();
})();
