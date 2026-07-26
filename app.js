/* ==========================================================================
   Zone 1–3 Finder — application
   Data lives in data.js (window.LISTINGS). This file is the view + engine:
   search parsing, faceted filtering, the shared-ownership calculator,
   the saved-shortlist store and rendering.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- config */
  const RENT_RATE = 0.025;      // annual rent charged on the unsold share
  const BUDGET    = 250000;     // cash available for a purchase / share
  const LS_SAVED  = 'z13_saved_v1';
  const LS_ADDED  = 'z13_added_v1';
  const SWEEP     = '26 Jul 2026';

  const ROUTE_LABEL = { rent: 'rentals', buy: 'part-buy options', own: 'outright buys' };

  const SCHEME_LABEL = {
    so: 'Shared ownership', intrent: 'Intermediate rent', rent2buy: 'Rent-to-buy',
    direct: 'Full ownership', verify: 'Tenure to confirm', auction: 'Auction',
    outright: 'Full ownership', maxshare: 'Strategy', firsthomes: 'First Homes',
    rent: 'Rental', pending: 'Pending'
  };

  const TYPE_LABEL = { studio: 'Studio', '1bed': '1 bed', '2bed': '2 bed', '3bed': '3 bed', llr: 'Scheme', any: '—' };

  /* ------------------------------------------------------------- utilities */
  const $  = (s, r) => (r || document).querySelector(s);
  const el = (t, c) => { const n = document.createElement(t); if (c) n.className = c; return n; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const gbp = n => '£' + Number(n).toLocaleString('en-GB');
  const icon = (id, cls) => `<svg class="i ${cls || ''}"><use href="#${id}"/></svg>`;

  function store(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function persist(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode */ }
  }

  /* Rightmove and Zoopla block hot-linked images from other domains, so route
     thumbnails through an image proxy. Falls back to a placeholder on error. */
  function thumbSrc(url) {
    if (!url) return '';
    return 'https://wsrv.nl/?url=' + encodeURIComponent(url.replace(/^https?:\/\//, '')) +
           '&w=640&h=480&fit=cover&output=webp&q=78';
  }

  /* --------------------------------------------------------------- the data */
  const DATA = (window.LISTINGS || []).slice();

  let saved = new Set(store(LS_SAVED, []));
  let added = store(LS_ADDED, []);

  const state = {
    route: 'rent',
    q: '',
    zone: '', beds: '', scheme: '', status: '',
    maxPrice: '', maxMonthly: '', sharePct: '', sort: 'relevance'
  };

  /* User submissions become provisional listings in the route they were filed under. */
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'link'; } }
  function addedAsListings() {
    return added.map(a => ({
      id: a.id, route: a.route || 'rent', addr: a.addr || hostOf(a.url),
      area: (a.area ? a.area + ' · ' : '') + 'added by you', zone: null,
      type: a.type || 'any', price: a.price ? Number(a.price) : null, unit: 'as entered',
      scheme: 'pending', mo: null, moEst: 0, full: 'details to be verified',
      src: hostOf(a.url), url: a.url, img: '',
      note: a.note || 'Added from a link. Use “Copy to share” to pass it on, and the full details will be filled in on the next update.',
      tags: ['added by you', 'pending'], star: 0, isNew: 1, added: a.when, pending: 1
    }));
  }
  const pool = () => addedAsListings().concat(DATA);

  /* -------------------------------------------------- shared-ownership maths */
  const effShare = d => (state.sharePct && d.fullVal)
    ? Math.round(d.fullVal * Number(state.sharePct) / 100) : d.price;
  const effRent = d => (state.sharePct && d.fullVal)
    ? Math.round(d.fullVal * (100 - Number(state.sharePct)) / 100 * RENT_RATE / 12) : d.mo;
  const affordPct = d => d.fullVal ? Math.min(100, Math.floor(BUDGET / d.fullVal * 100)) : null;

  /* ------------------------------------------------------- search behaviour */
  /* Free text plus simple numeric intents: "under 1100", "max 250k", "over 900". */
  function parseQuery(raw) {
    const out = { terms: [], under: null, over: null, zones: [], types: [] };
    if (!raw) return out;
    let s = ' ' + raw.toLowerCase().trim() + ' ';

    /* "zone 2", "zone 2-3" → zone intent (a bare "2" is too loose to match on) */
    s = s.replace(/\bzone[s]?\s*([1-3])\s*(?:[–-]\s*([1-3]))?/g, (_, a, b) => {
      out.zones.push(a); if (b) out.zones.push(b); return ' ';
    });
    /* "2 bed", "two-bedroom", "studio" → size intent */
    s = s.replace(/\b([1-3])\s*[-\s]?\s*bed(?:room)?s?\b/g, (_, n) => { out.types.push(n + 'bed'); return ' '; });
    s = s.replace(/\bstudios?\b/g, () => { out.types.push('studio'); return ' '; });
    const num = t => {
      let m = t.match(/^£?([\d,.]+)\s*(k|m)?$/);
      if (!m) return null;
      let n = parseFloat(m[1].replace(/,/g, ''));
      if (isNaN(n)) return null;
      if (m[2] === 'k') n *= 1000;
      if (m[2] === 'm') n *= 1000000;
      return n;
    };
    s = s.replace(/\b(under|below|less than|max|upto|up to|<)\s*(£?[\d,.]+\s*[km]?)/g, (_, __, v) => {
      const n = num(v.trim()); if (n) out.under = out.under == null ? n : Math.min(out.under, n); return ' ';
    });
    s = s.replace(/\b(over|above|from|more than|>)\s*(£?[\d,.]+\s*[km]?)/g, (_, __, v) => {
      const n = num(v.trim()); if (n) out.over = out.over == null ? n : Math.max(out.over, n); return ' ';
    });
    out.terms = s.split(/[\s,]+/).map(t => t.replace(/[£"']/g, '')).filter(t => t.length > 1);
    return out;
  }

  function haystack(d) {
    if (d._hay) return d._hay;
    d._hay = [d.addr, d.area, d.note, d.full, d.unit, d.src, d.zone && 'zone ' + d.zone,
      TYPE_LABEL[d.type], SCHEME_LABEL[d.scheme], (d.tags || []).join(' ')]
      .filter(Boolean).join(' ').toLowerCase();
    return d._hay;
  }

  /* Every term must appear somewhere (AND), which makes multi-word queries precise. */
  function matchesQuery(d, pq) {
    if (pq.zones.length && !pq.zones.some(z => (d.zone || '').split('-').includes(z))) return false;
    if (pq.types.length && !pq.types.includes(d.type)) return false;
    if (pq.under != null) {
      const cands = [effShare(d), effRent(d)].filter(v => v != null);
      if (cands.length && !cands.some(v => v <= pq.under)) return false;
    }
    if (pq.over != null) {
      const cands = [effShare(d), effRent(d)].filter(v => v != null);
      if (cands.length && !cands.some(v => v >= pq.over)) return false;
    }
    if (!pq.terms.length) return true;
    const hay = haystack(d);
    return pq.terms.every(t => hay.indexOf(t) !== -1);
  }

  /* A facet only applies when its control is visible for the current route —
     otherwise a leftover value could filter results invisibly. */
  function visibleKeys() {
    if (!visibleKeys._c || visibleKeys._r !== state.route) {
      visibleKeys._r = state.route;
      visibleKeys._c = new Set(fieldsFor(state.route).map(f => f.k));
    }
    return visibleKeys._c;
  }

  function matchesFacets(d) {
    const vis = visibleKeys();
    if (state.zone && !(d.zone || '').split('-').includes(state.zone)) return false;
    if (state.beds && d.type !== state.beds) return false;
    if (state.scheme && vis.has('scheme')) {
      if (state.scheme === 'ownership') { if (!['direct', 'outright', 'verify'].includes(d.scheme)) return false; }
      else if (d.scheme !== state.scheme) return false;
    }
    if (state.status) {
      if (state.status === 'available' && d.gone) return false;
      if (state.status === 'gone' && !d.gone) return false;
      if (state.status === 'saved' && !saved.has(d.id)) return false;
      if (state.status === 'new' && (!d.isNew || d.gone)) return false;
      if (state.status === 'added' && !d.pending) return false;
      if (state.status === 'top' && !d.star) return false;
    }
    if (state.maxPrice && vis.has('maxPrice')) {
      const p = effShare(d); if (p == null || p > Number(state.maxPrice)) return false;
    }
    if (state.maxMonthly && vis.has('maxMonthly')) {
      const r = state.route === 'rent' ? d.price : effRent(d);
      if (r == null || r > Number(state.maxMonthly)) return false;
    }
    return true;
  }

  function results() {
    const pq = parseQuery(state.q);
    let list = pool().filter(d => d.route === state.route && matchesFacets(d) && matchesQuery(d, pq));
    /* unpriced entries always sort last, whichever direction */
    const key = {
      'price-asc':   d => effShare(d) == null ? Infinity : effShare(d),
      'price-desc':  d => effShare(d) == null ? Infinity : -effShare(d),
      'monthly-asc': d => { const r = state.route === 'rent' ? d.price : effRent(d); return r == null ? Infinity : r; }
    }[state.sort];
    if (key) list.sort((a, b) => key(a) - key(b));
    else if (state.sort === 'newest') list.sort((a, b) => String(b.added || '').localeCompare(String(a.added || '')));
    else list.sort((a, b) => (b.star - a.star) || (Number(!a.gone) - Number(!b.gone)) * -1 || 0);
    // keep sold/let entries out of the way by default
    if (!state.status) list.sort((a, b) => Number(!!a.gone) - Number(!!b.gone));
    return list;
  }

  /* --------------------------------------------------------- filter controls */
  const PRICE_STEPS = {
    rent: [[900, '£900'], [1100, '£1,100'], [1300, '£1,300'], [1600, '£1,600'], [2000, '£2,000']],
    buy:  [[60000, '£60k'], [100000, '£100k'], [125000, '£125k'], [150000, '£150k'], [200000, '£200k'], [250000, '£250k']],
    own:  [[200000, '£200k'], [250000, '£250k'], [270000, '£270k'], [300000, '£300k'], [325000, '£325k']]
  };
  const MONTHLY_STEPS = [[300, '£300'], [450, '£450'], [600, '£600'], [800, '£800'], [1000, '£1,000'], [1250, '£1,250']];

  function fieldsFor(route) {
    const f = [];
    f.push({ k: 'zone', label: 'Zone', opts: [['', 'Any zone'], ['1', 'Zone 1'], ['2', 'Zone 2'], ['3', 'Zone 3']] });
    f.push({ k: 'beds', label: 'Bedrooms', opts: [['', 'Any size'], ['studio', 'Studio'], ['1bed', '1 bed'], ['2bed', '2 bed'], ['3bed', '3 bed']] });

    if (route === 'rent') {
      f.push({ k: 'maxMonthly', label: 'Max rent pcm', opts: [['', 'Any rent']].concat(PRICE_STEPS.rent.map(([v, l]) => [v, 'Up to ' + l])) });
    }
    if (route === 'buy') {
      f.push({ k: 'scheme', label: 'Scheme', wide: true, opts: [['', 'All schemes'], ['so', 'Shared ownership'],
        ['intrent', 'Intermediate rent'], ['rent2buy', 'Rent-to-buy'], ['ownership', 'Full ownership'], ['auction', 'Auction']] });
      f.push({ k: 'maxPrice', label: 'Max share cost', wide: true, opts: [['', 'Any cost']].concat(PRICE_STEPS.buy.map(([v, l]) => [v, 'Up to ' + l])) });
      f.push({ k: 'maxMonthly', label: 'Max rent pcm', opts: [['', 'Any rent']].concat(MONTHLY_STEPS.map(([v, l]) => [v, 'Up to ' + l])) });
      f.push({ k: 'sharePct', label: 'Share to buy', wide: true, calc: true,
        opts: [['', 'As listed'], ['25', '25% share'], ['40', '40% share'], ['50', '50% share'], ['75', '75% share'], ['100', '100% — own it']] });
    }
    if (route === 'own') {
      f.push({ k: 'maxPrice', label: 'Max price', wide: true, opts: [['', 'Any price']].concat(PRICE_STEPS.own.map(([v, l]) => [v, 'Up to ' + l])) });
    }
    f.push({ k: 'status', label: 'Status', opts: [['', 'Everything'], ['available', 'Available only'],
      ['saved', 'Saved'], ['new', 'New this sweep'], ['top', 'Top picks'], ['added', 'Added by you'], ['gone', 'Sold or let']] });
    f.push({ k: 'sort', label: 'Sort', wide: true, opts: [['relevance', 'Best match'],
      ['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low'], ['monthly-asc', 'Monthly cost: lowest'], ['newest', 'Newest first']] });
    return f;
  }

  function renderFilters() {
    const host = $('#filters');
    host.innerHTML = '';
    fieldsFor(state.route).forEach(f => {
      const wrap = el('div', 'field' + (f.wide ? ' wide' : ''));
      const lab = el('label');
      lab.textContent = f.label;
      lab.setAttribute('for', 'f_' + f.k);
      const sel = el('div', 'sel');
      const isSet = f.k === 'sort' ? state.sort !== 'relevance' : !!state[f.k];
      if (isSet) sel.classList.add('set');
      const s = el('select');
      s.id = 'f_' + f.k;
      f.opts.forEach(([v, l]) => {
        const o = el('option'); o.value = v; o.textContent = l;
        if (String(state[f.k]) === String(v)) o.selected = true;
        s.appendChild(o);
      });
      s.addEventListener('change', () => { state[f.k] = s.value; render(); });
      sel.appendChild(s);
      sel.insertAdjacentHTML('beforeend', icon('i-chev'));
      wrap.appendChild(lab); wrap.appendChild(sel);
      host.appendChild(wrap);
    });
    const reset = el('button', 'btn subtle');
    reset.innerHTML = icon('i-x') + ' Reset';
    reset.addEventListener('click', clearAll);
    host.appendChild(reset);
  }

  function clearAll() {
    state.q = ''; $('#q').value = '';
    ['zone', 'beds', 'scheme', 'status', 'maxPrice', 'maxMonthly', 'sharePct'].forEach(k => state[k] = '');
    state.sort = 'relevance';
    render();
  }

  /* ------------------------------------------------------------ active tags */
  function renderActiveTags() {
    const host = $('#activeTags');
    host.innerHTML = '';
    const labelOf = (k, v) => {
      const f = fieldsFor(state.route).find(x => x.k === k);
      const hit = f && f.opts.find(o => String(o[0]) === String(v));
      return hit ? hit[1] : v;
    };
    const tags = [];
    if (state.q) tags.push(['q', '“' + state.q + '”']);
    ['zone', 'beds', 'scheme', 'status', 'maxPrice', 'maxMonthly', 'sharePct'].forEach(k => {
      if (state[k]) tags.push([k, labelOf(k, state[k])]);
    });
    if (state.sort !== 'relevance') tags.push(['sort', labelOf('sort', state.sort)]);
    tags.forEach(([k, label]) => {
      const t = el('span', 'atag');
      t.innerHTML = esc(label) + ' <button aria-label="Remove filter">' + icon('i-x') + '</button>';
      t.querySelector('button').addEventListener('click', () => {
        if (k === 'q') { state.q = ''; $('#q').value = ''; }
        else if (k === 'sort') state.sort = 'relevance';
        else state[k] = '';
        render();
      });
      host.appendChild(t);
    });
    if (tags.length > 1) {
      const c = el('button', 'btn subtle');
      c.style.height = '26px'; c.style.fontSize = '12px';
      c.textContent = 'Clear all';
      c.addEventListener('click', clearAll);
      host.appendChild(c);
    }
  }

  /* ----------------------------------------------------------------- notices */
  function renderNotice() {
    const slot = $('#noticeSlot');
    slot.innerHTML = '';
    if (state.route !== 'buy') return;
    const n = el('div', 'notice');
    n.innerHTML = icon('i-calc') +
      '<div><b>How a share works.</b> You buy a share outright and pay subsidised rent on the rest — about ' +
      '2.5% a year of the part you don\'t own. Buying more later (“staircasing”) cuts the rent, and at 100% ' +
      'there is none. Set <b>Share to buy</b> above to reprice every listing and see the rent at that share. ' +
      'A ' + gbp(BUDGET) + ' budget is assumed when showing what share you could afford.</div>';
    slot.appendChild(n);
  }

  /* ------------------------------------------------------------------- cards */
  function flagsFor(d) {
    const out = [];
    if (d.gone) out.push(`<span class="flag f-gone">${icon('i-slash')}${d.gone === 'sold' ? 'Sold' : 'Let'}</span>`);
    else if (d.isNew) out.push(`<span class="flag f-new">${icon('i-sparkle')}New</span>`);
    if (d.star) out.push(`<span class="flag f-top">${icon('i-badge')}Top pick</span>`);
    if (d.scheme === 'so') out.push('<span class="flag f-scheme">Share</span>');
    if (d.scheme === 'intrent' || d.scheme === 'rent2buy') out.push('<span class="flag f-scheme">' + SCHEME_LABEL[d.scheme] + '</span>');
    if (d.scheme === 'outright' || d.scheme === 'direct') out.push('<span class="flag f-own">100% owned</span>');
    if (d.scheme === 'auction') out.push('<span class="flag f-gone">Auction</span>');
    if (d.scheme === 'verify') out.push('<span class="flag f-new">Check tenure</span>');
    if (d.pending) out.push('<span class="flag f-scheme">Pending</span>');
    return out.join('');
  }

  function priceTag(d) {
    if (state.route === 'rent') {
      return `<div class="tag-price"><b class="num">${gbp(d.price)}</b><span>${d.type === '2bed' ? 'total pcm' : 'pcm'}</span></div>`;
    }
    const p = effShare(d);
    if (p == null) return `<div class="tag-price"><b>See listing</b><span>${esc(d.unit || '')}</span></div>`;
    const unit = (state.sharePct && d.fullVal) ? state.sharePct + '% share' : (d.unit || '');
    return `<div class="tag-price"><b class="num">${gbp(p)}</b><span>${esc(unit)}</span></div>`;
  }

  function figsFor(d) {
    const f = [];
    if (d.type && TYPE_LABEL[d.type] && d.type !== 'any' && d.type !== 'llr')
      f.push(`<span class="fig">${icon('i-bed')}${TYPE_LABEL[d.type]}</span>`);
    if (d.zone) f.push(`<span class="fig">${icon('i-pin')}Zone ${esc(d.zone)}</span>`);
    if (state.route === 'rent') {
      if (d.bills === 'all')  f.push(`<span class="fig pos">${icon('i-check')}All bills included</span>`);
      if (d.bills === 'most') f.push(`<span class="fig pos">${icon('i-check')}Most bills included</span>`);
    } else {
      const r = effRent(d);
      if (r != null && r > 0) {
        const est = (d.moEst || (state.sharePct && d.fullVal)) ? ' est.' : '';
        f.push(`<span class="fig rent">${icon('i-coin')}${gbp(r)}/mo rent${est}</span>`);
      } else if (['direct', 'outright', 'auction', 'verify'].includes(d.scheme) || (state.sharePct === '100' && d.fullVal)) {
        f.push(`<span class="fig pos">${icon('i-check')}No rent — owned outright</span>`);
      }
    }
    return f.length ? `<div class="figs">${f.join('')}</div>` : '';
  }

  function card(d) {
    const c = el('div', 'card' + (d.gone ? ' is-gone' : '') + (d.pending ? ' is-pending' : ''));
    const isSaved = saved.has(d.id);
    const src = thumbSrc(d.img);
    const pct = (state.route === 'buy') ? affordPct(d) : null;

    c.innerHTML = `
      <div class="thumb">
        ${src ? `<img loading="lazy" decoding="async" alt="" src="${esc(src)}"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
           <div class="ph" style="display:none">${icon('i-image')}<span>Photo on ${esc(d.src)}</span></div>`
          : `<div class="ph">${icon('i-image')}<span>Photo on ${esc(d.src)}</span></div>`}
        <div class="flags">${flagsFor(d)}</div>
        <button class="save${isSaved ? ' on' : ''}" data-save="${esc(d.id)}"
          title="${isSaved ? 'Remove from saved' : 'Save this home'}" aria-pressed="${isSaved}">
          ${icon(isSaved ? 'i-heart-f' : 'i-heart')}</button>
        ${priceTag(d)}
      </div>
      <div class="body">
        <div class="addr">${esc(d.addr)}</div>
        <div class="area">${esc(d.area)}</div>
        ${figsFor(d)}
        ${d.gone ? `<div class="gonebar">${icon('i-alert')}<span>${d.gone === 'sold' ? 'Sold' : 'Let'}${d.goneOn ? ' · spotted ' + esc(d.goneOn) : ''}${d.goneWhy ? ' — ' + esc(d.goneWhy) : ''}</span></div>` : ''}
        ${pct != null ? `<div class="afford">Full market value ${gbp(d.fullVal)} · a ${gbp(BUDGET)} budget buys about <b>${pct}%</b>${pct >= 100 ? ' — outright' : ''}</div>` : ''}
        <div class="note">${esc(d.note)}</div>
        <div class="chips">${(d.tags || []).slice(0, 4).map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>
        <a class="go" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">
          View on ${esc(d.src)} ${icon('i-ext')}</a>
      </div>`;
    return c;
  }

  /* ---------------------------------------------------------------- rendering */
  function render() {
    renderFilters();
    renderActiveTags();
    renderNotice();

    const list = results();
    const total = pool().filter(d => d.route === state.route).length;
    const grid = $('#grid');
    grid.innerHTML = '';

    if (!list.length) {
      const e = el('div', 'empty');
      /* the same search may well have hits under another route — say so */
      const pq = parseQuery(state.q);
      const elsewhere = ['rent', 'buy', 'own'].filter(r => r !== state.route).map(r => ({
        route: r,
        n: pool().filter(d => d.route === r && matchesQuery(d, pq)).length
      })).filter(x => x.n);

      e.innerHTML = icon('i-search') +
        '<h3>Nothing matches here</h3>' +
        '<p>Try widening the price, clearing the search, or looking under another route.</p>';

      if (elsewhere.length && state.q) {
        const hint = el('div');
        hint.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:14px';
        elsewhere.forEach(x => {
          const b = el('button', 'btn');
          b.innerHTML = `${x.n} match${x.n > 1 ? 'es' : ''} in <b style="margin-left:4px">${ROUTE_LABEL[x.route]}</b>`;
          b.addEventListener('click', () => {
            state.route = x.route;
            ['scheme', 'maxPrice', 'maxMonthly', 'sharePct', 'status'].forEach(k => state[k] = '');
            document.querySelectorAll('.route').forEach(r => r.setAttribute('aria-selected', String(r.dataset.route === x.route)));
            render();
          });
          hint.appendChild(b);
        });
        e.appendChild(hint);
      }
      const b = el('button', 'btn subtle'); b.textContent = 'Reset all filters';
      b.addEventListener('click', clearAll);
      e.appendChild(b);
      grid.appendChild(e);
    } else {
      const frag = document.createDocumentFragment();
      list.forEach(d => frag.appendChild(card(d)));
      grid.appendChild(frag);
    }

    $('#resMeta').innerHTML = `<b class="num">${list.length}</b> of <span class="num">${total}</span> ${ROUTE_LABEL[state.route]}` +
      (state.q || state.zone || state.beds || state.scheme || state.status || state.maxPrice || state.maxMonthly ? ' match' : '');

    $('#statTotal').textContent = pool().length;
    $('#statSaved').textContent = saved.size;
    $('#statSweep').textContent = SWEEP.replace(' 2026', '');
    document.querySelectorAll('[data-rc]').forEach(n => {
      n.textContent = pool().filter(d => d.route === n.dataset.rc).length;
    });
    $('#searchBox').classList.toggle('has', !!state.q);
  }

  /* ------------------------------------------------------------------ events */
  $('#routes').addEventListener('click', e => {
    const b = e.target.closest('.route'); if (!b) return;
    document.querySelectorAll('.route').forEach(r => r.setAttribute('aria-selected', String(r === b)));
    state.route = b.dataset.route;
    ['scheme', 'maxPrice', 'maxMonthly', 'sharePct'].forEach(k => state[k] = '');
    state.sort = 'relevance';
    render();
  });

  let qTimer;
  $('#q').addEventListener('input', e => {
    clearTimeout(qTimer);
    const v = e.target.value;
    qTimer = setTimeout(() => { state.q = v.trim(); render(); }, 130);
  });
  $('#qClear').addEventListener('click', () => { state.q = ''; $('#q').value = ''; $('#q').focus(); render(); });

  $('#grid').addEventListener('click', e => {
    const b = e.target.closest('[data-save]'); if (!b) return;
    e.preventDefault();
    const id = b.dataset.save;
    if (saved.has(id)) saved.delete(id); else saved.add(id);
    persist(LS_SAVED, [...saved]);
    render();
  });

  /* --------------------------------------------------------- add-a-flat form */
  function buildAddPanel() {
    const wrap = $('#addWrap');
    const p = el('div', 'addcard');
    p.style.display = 'none';
    p.innerHTML = `
      <h3>${icon('i-plus')} Add a home you've found</h3>
      <p>Paste a link from Rightmove, Zoopla, OpenRent, Share to Buy or an agent. It appears immediately as a
         <b>pending</b> card saved in this browser. Use <b>Copy to share</b> to send it on, and the full
         details — price, bedrooms, photo — get filled in on the next update.</p>
      <div class="addgrid">
        <input id="aUrl" type="url" placeholder="Paste the link (required)">
        <input id="aAddr" type="text" placeholder="Address or area (optional)">
        <input id="aPrice" type="text" inputmode="numeric" placeholder="Price, e.g. 250000">
        <select id="aType">
          <option value="">Size (optional)</option><option value="studio">Studio</option>
          <option value="1bed">1 bed</option><option value="2bed">2 bed</option><option value="3bed">3 bed</option>
        </select>
        <select id="aRoute">
          <option value="rent">Route: rent</option>
          <option value="buy">Route: part-buy</option>
          <option value="own">Route: own outright</option>
        </select>
        <input id="aNote" type="text" placeholder="Note, e.g. near the station">
      </div>
      <div class="addactions">
        <button class="btn primary" id="aSave">${icon('i-plus')} Add to list</button>
        <button class="btn" id="aCopy">${icon('i-copy')} Add &amp; copy to share</button>
        <button class="btn" id="aCopyAll">${icon('i-copy')} Copy my shortlist</button>
        <button class="btn subtle danger" id="aClear">Clear added</button>
      </div>
      <div class="formmsg" id="aMsg"></div>`;
    wrap.appendChild(p);

    const msg = (text, isErr) => {
      const m = $('#aMsg');
      m.className = 'formmsg' + (isErr ? ' err' : '');
      m.innerHTML = (isErr ? icon('i-alert') : icon('i-check')) + '<span>' + esc(text) + '</span>';
    };

    $('#addToggle').addEventListener('click', () => {
      const open = p.style.display === 'none';
      p.style.display = open ? 'block' : 'none';
      if (open) $('#aUrl').focus();
    });

    function read() {
      const url = ($('#aUrl').value || '').trim();
      if (!/^https?:\/\/.+\..+/i.test(url)) { msg('Paste a full link starting with http:// or https://', true); return null; }
      return {
        id: 'user' + Date.now(), url,
        addr: ($('#aAddr').value || '').trim(), area: ($('#aAddr').value || '').trim(),
        price: ($('#aPrice').value || '').replace(/[^\d]/g, ''),
        type: $('#aType').value, route: $('#aRoute').value,
        note: ($('#aNote').value || '').trim(),
        when: new Date().toISOString().slice(0, 10)
      };
    }
    function reset() { ['aUrl', 'aAddr', 'aPrice', 'aNote'].forEach(id => $('#' + id).value = ''); $('#aType').value = ''; }
    function summary(f) {
      return ['Home for the tracker', 'Link: ' + f.url,
        f.addr && 'Area: ' + f.addr, f.price && 'Price: ' + gbp(f.price),
        f.type && 'Size: ' + TYPE_LABEL[f.type], 'Route: ' + f.route,
        f.note && 'Note: ' + f.note].filter(Boolean).join('\n');
    }
    function copy(text, ok) {
      const done = () => msg(ok);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else fallback();
      function fallback() {
        const ta = el('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); }
        catch (err) { msg('Could not copy automatically — copy the link manually.', true); }
        document.body.removeChild(ta);
      }
    }
    function commit(f, then) {
      added.push(f); persist(LS_ADDED, added); reset();
      state.route = f.route; state.status = 'added';
      state.q = ''; $('#q').value = '';
      ['zone', 'beds', 'scheme', 'maxPrice', 'maxMonthly', 'sharePct'].forEach(k => state[k] = '');
      document.querySelectorAll('.route').forEach(r => r.setAttribute('aria-selected', String(r.dataset.route === f.route)));
      render(); then();
    }

    $('#aSave').addEventListener('click', () => {
      const f = read(); if (!f) return;
      commit(f, () => msg('Added — showing as a pending card.'));
    });
    $('#aCopy').addEventListener('click', () => {
      const f = read(); if (!f) return;
      commit(f, () => copy(summary(f), 'Added and copied — paste it wherever you like.'));
    });
    $('#aCopyAll').addEventListener('click', () => {
      const mine = pool().filter(d => saved.has(d.id));
      if (!mine.length && !added.length) { msg('Nothing saved yet — tap the heart on a card first.', true); return; }
      let out = 'My shortlist\n';
      if (mine.length) {
        out += '\nSaved:\n' + mine.map(d => '• ' + d.addr + ' — ' +
          (effShare(d) != null ? gbp(effShare(d)) : 'see listing') + ' — ' + d.url).join('\n') + '\n';
      }
      if (added.length) {
        out += '\nAdded by me:\n' + added.map(a => '• ' + (a.addr || hostOf(a.url)) + ' — ' + a.url).join('\n') + '\n';
      }
      copy(out, 'Shortlist copied to your clipboard.');
    });
    $('#aClear').addEventListener('click', () => {
      if (!added.length) { msg('You have not added anything yet.', true); return; }
      added = []; persist(LS_ADDED, added);
      if (state.status === 'added') state.status = '';
      render(); msg('Added homes cleared. Saved hearts kept.');
    });
  }

  /* -------------------------------------------------------------------- boot */
  buildAddPanel();
  render();
})();
