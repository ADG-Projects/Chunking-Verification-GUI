let PDF_DOC = null;
let CURRENT_PAGE = 1;
let PAGE_COUNT = 0;
let SCALE = 1.1; // 110%
let CURRENT_SLUG = null;
let BOX_INDEX = {}; // element_id -> {page_trimmed, layout_w,h, x,y,w,h}
let MATCHES = null;
let LAST_SELECTED_MATCH = null;
let CHART_INSTANCE = null;
let CURRENT_ELEMENT_ID = null;
let CHIP_META = {}; // element_id -> meta from /api/elements
let LAST_HIGHLIGHT_MODE = 'all'; // 'all' | 'best'

const $ = (id) => document.getElementById(id);

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
  return r.json();
}

function setMetric(idBase, value) {
  const pct = Math.round((value || 0) * 100);
  $(idBase).style.width = `${pct}%`;
  $(`${idBase}v`).textContent = `${(value || 0).toFixed(3)} (${pct}%)`;
}

function renderMetrics(overall) {
  setMetric('mcov', overall.avg_coverage);
  setMetric('mcoh', overall.avg_cohesion);
  setMetric('mf1', overall.avg_chunker_f1);
  setMetric('mmicro', overall.micro_coverage);
}

function buildChart(matches) {
  const ctx = document.getElementById('chart');
  const labels = matches.map(m => m.gold_title || m.gold_table_id);
  const data = matches.map(m => Number(m.chunker_f1 || 0));
  if (CHART_INSTANCE) {
    CHART_INSTANCE.destroy();
  }
  CHART_INSTANCE = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Chunker F1', data, backgroundColor: '#6bbcff' }]},
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 1 } } }
  });
}

function pxRect(points) {
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(...xs) - x;
  const h = Math.max(...ys) - y;
  return { x, y, w, h };
}

function clearBoxes() {
  const overlay = $('overlay');
  overlay.innerHTML = '';
}

function addBox(rect, layoutW, layoutH, isBest=false) {
  const overlay = $('overlay');
  const canvas = $('pdfCanvas');
  const scaleX = canvas.width / layoutW;
  const scaleY = canvas.height / layoutH;
  const el = document.createElement('div');
  el.className = 'box' + (isBest ? ' best' : '');
  el.style.left = `${rect.x * scaleX}px`;
  el.style.top = `${rect.y * scaleY}px`;
  el.style.width = `${rect.w * scaleX}px`;
  el.style.height = `${rect.h * scaleY}px`;
  overlay.appendChild(el);
}

async function highlightForTable(tableMatch, bestOnly=false) {
  const targets = bestOnly
    ? [{ element_id: tableMatch.best_element_id, page_trimmed: tableMatch.best_page_trimmed }]
    : tableMatch.selected_elements;

  LAST_SELECTED_MATCH = tableMatch;
  LAST_HIGHLIGHT_MODE = bestOnly ? 'best' : 'all';

  const ids = targets.map(t => t.element_id).filter(Boolean);
  // Fetch minimal boxes for these IDs
  if (ids.length) {
    BOX_INDEX = await fetchJSON(`/api/elements/${encodeURIComponent(CURRENT_SLUG)}?ids=${encodeURIComponent(ids.join(','))}`);
  }

  const pages = new Set(targets.map(t => t.page_trimmed));
  const arr = [...pages];
  let pageToShow = CURRENT_PAGE;
  if (!pages.has(CURRENT_PAGE) && arr.length) {
    // Stay on current page if it contains the table; otherwise go to earliest page containing it
    pageToShow = Math.min(...arr);
  }
  if (pageToShow !== CURRENT_PAGE) {
    await renderPage(pageToShow);
  }
  drawTargetsOnPage(pageToShow, tableMatch, bestOnly);
}

function drawTargetsOnPage(pageNum, tableMatch, bestOnly=false) {
  clearBoxes();
  const targets = bestOnly
    ? [{ element_id: tableMatch.best_element_id, page_trimmed: tableMatch.best_page_trimmed }]
    : tableMatch.selected_elements;

  for (const t of targets) {
    if (t.page_trimmed !== pageNum) continue;
    const entry = BOX_INDEX[t.element_id];
    if (!entry) continue;
    const rect = { x: entry.x, y: entry.y, w: entry.w, h: entry.h };
    const isBest = bestOnly || t.element_id === tableMatch.best_element_id;
    addBox(rect, entry.layout_w, entry.layout_h, isBest);
  }
}

function renderMatchList(matches) {
  const list = $('matchList');
  list.innerHTML = '';
  for (const m of matches) {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <div class="top">
        <div>
          <div class="title">${m.gold_title || m.gold_table_id}</div>
          <div class="meta">Pages: ${m.gold_pages?.join(', ') ?? '-'}</div>
        </div>
        <div class="actions">
          <button class="btn" data-act="highlight-all" title="Overlay all selected chunks">Highlight all</button>
          <button class="btn" data-act="highlight-best" title="Overlay only the best chunk">Highlight best</button>
          <button class="btn" data-act="details">Details</button>
        </div>
      </div>
      <div class="row" style="margin-top:8px">
        <span class="chip">cov ${(m.coverage||0).toFixed(2)}</span>
        <span class="chip">coh ${(m.cohesion||0).toFixed(2)}</span>
        <span class="chip ${m.selected_chunk_count>1 ? 'bad':''}">chunks ${m.selected_chunk_count}</span>
        <span class="chip">f1 ${(m.chunker_f1||0).toFixed(2)}</span>
      </div>
    `;
    div.querySelector('[data-act="highlight-all"]').addEventListener('click', () => {
      highlightForTable(m, false);
    });
    div.querySelector('[data-act="highlight-best"]').addEventListener('click', () => {
      highlightForTable(m, true);
    });
    div.querySelector('[data-act="details"]').addEventListener('click', () => {
      openDetails(m);
    });
    list.appendChild(div);
  }
}

async function openDetails(tableMatch) {
  LAST_SELECTED_MATCH = tableMatch;
  const title = tableMatch.gold_title || tableMatch.gold_table_id;
  $('drawerTitle').textContent = 'Unstructured Chunks';
  $('drawerMeta').innerHTML = `${title} · Source: Unstructured <span class="chip-tag">chunks ${tableMatch.selected_chunk_count}</span>`;
  // Build pretty summary bars for table-level metrics
  const sum = document.getElementById('drawerSummary');
  sum.innerHTML = '';
  const addRow = (label, val, tip) => {
    const row = document.createElement('div');
    row.className = 'mini-metric';
    row.innerHTML = `<div class="label">${label}${tip?` <span class=\"info\" tabindex=\"0\">i</span><div class=\"tip\">${tip}</div>`:''}</div><div class="bar"><div class="fill" style="width:${Math.round((val||0)*100)}%"></div></div><div class="value">${(val||0).toFixed(3)}</div>`;
    sum.appendChild(row);
  };
  addRow('Table coverage', Number(tableMatch.coverage ?? tableMatch.coverage_ratio ?? 0), 'Share of gold rows covered across the table\'s selected chunks.');
  addRow('Table cohesion', Number(tableMatch.cohesion || 0), '1 / selected_chunk_count — higher when the table stays in one chunk.');
  addRow('Table F1', Number(tableMatch.chunker_f1 || 0), 'Harmonic mean of table coverage and table cohesion.');
  const picker = $('elementPicker');
  picker.innerHTML = '';
  const bestId = tableMatch.best_element_id;
  const items = (tableMatch.selected_elements || []).map(s => s.element_id);
  const unique = Array.from(new Set([bestId, ...items].filter(Boolean)));
  if (unique.length) {
    CHIP_META = await fetchJSON(`/api/elements/${encodeURIComponent(CURRENT_SLUG)}?ids=${encodeURIComponent(unique.join(','))}`);
  } else {
    CHIP_META = {};
  }
  for (const id of unique) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const short = id.replace('chunk-', '…');
    const meta = CHIP_META[id] || {};
    const selInfo = (tableMatch.selected_elements || []).find(x => x.element_id === id) || {};
    const pTrim = selInfo.page_trimmed || meta.page_trimmed || '-';
    const cov = selInfo.row_overlap ?? selInfo.cohesion;
    const covTag = cov != null ? ` <span class=\"chip-tag\">cov ${(Number(cov)||0).toFixed(2)}</span>` : '';
    const bestTag = id===bestId? ' <span class=\"chip-tag best\">best</span>' : '';
    chip.innerHTML = `${short} <span class=\"chip-tag\">p${pTrim}</span>${covTag}${bestTag}`;
    chip.title = `Unstructured chunk: ${id}\npage_trimmed=${pTrim}${selInfo.page_original?`, page_original=${selInfo.page_original}`:''}${selInfo.cohesion!=null?`, cohesion=${selInfo.cohesion.toFixed(3)}`:''}${selInfo.row_overlap!=null?`, row_overlap=${selInfo.row_overlap.toFixed(3)}`:''}`;
    chip.addEventListener('click', async () => {
      for (const n of picker.querySelectorAll('.chip')) n.classList.remove('active');
      chip.classList.add('active');
      CURRENT_ELEMENT_ID = id;
      await loadElementPreview(id);
    });
    picker.appendChild(chip);
  }
  $('drawer').classList.remove('hidden');
  $('preview').innerHTML = '<div class="placeholder">Loading…</div>';
  if (bestId) {
    CURRENT_ELEMENT_ID = bestId;
    const firstChip = picker.querySelector('.chip');
    if (firstChip) firstChip.classList.add('active');
    loadElementPreview(bestId);
  }
}

async function loadElementPreview(elementId) {
  try {
    const data = await fetchJSON(`/api/element/${encodeURIComponent(CURRENT_SLUG)}/${encodeURIComponent(elementId)}`);
    const html = data.text_as_html;
    const container = $('preview');
    container.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'preview-meta';
    const meta = CHIP_META[elementId] || {};
    const selInfo = (LAST_SELECTED_MATCH?.selected_elements || []).find(x => x.element_id === elementId) || {};
    head.innerHTML = `
      <span class="badge">Unstructured</span>
      <span>chunk: <code>${elementId}</code></span>
      <span>page: ${selInfo.page_original ?? selInfo.page_trimmed ?? meta.page_trimmed ?? '-'}</span>
      ${data.expected_cols ? `<span>expected_cols: ${data.expected_cols}</span>` : ''}
    `;
    container.appendChild(head);
    // Per-chunk contribution summary
    const mm = document.createElement('div');
    mm.className = 'mini-metrics';
    const chunkCov = Number(selInfo.row_overlap ?? selInfo.cohesion ?? 0);
    const chunkSoloF1 = chunkCov > 0 ? (2 * chunkCov) / (chunkCov + 1) : 0; // F1 if this chunk alone
    // table cohesion is already shown in the table summary above
    const tableCoh = (LAST_SELECTED_MATCH && LAST_SELECTED_MATCH.selected_chunk_count)
      ? (1 / LAST_SELECTED_MATCH.selected_chunk_count)
      : 0;
    const addRow = (label, val, tip) => {
      const row = document.createElement('div');
      row.className = 'mini-metric';
      row.innerHTML = `<div class="label">${label}${tip?` <span class=\"info\" tabindex=\"0\">i</span><div class=\"tip\">${tip}</div>`:''}</div><div class="bar"><div class="fill" style="width:${Math.round((val||0)*100)}%"></div></div><div class="value">${(val||0).toFixed(3)}</div>`;
      mm.appendChild(row);
    };
    addRow('Chunk coverage', chunkCov, 'Share of gold rows this single Unstructured chunk covers (row_overlap).');
    // omit table cohesion here to avoid duplication with the summary band
    addRow('Chunk F1 (solo)', chunkSoloF1, 'Harmonic mean of this chunk’s coverage and perfect cohesion (1.0) — how strong it would be on its own.');
    container.appendChild(mm);
    if (html) {
      // Safe enough for our local dataset; we still wrap and style
      const scroll = document.createElement('div');
      scroll.className = 'scrollbox';
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;
      scroll.appendChild(wrapper);
      container.appendChild(scroll);
    } else {
      const pre = document.createElement('pre');
      pre.textContent = data.text || '(no text)';
      container.appendChild(pre);
    }
  } catch (e) {
    $('preview').innerHTML = `<div class="placeholder">Failed to load element: ${e.message}</div>`;
  }
}

async function loadRun(slug) {
  CURRENT_SLUG = slug;
  // Load PDF
  const pdfUrl = `/pdf/${encodeURIComponent(slug)}`;
  const loadingTask = window['pdfjsLib'].getDocument(pdfUrl);
  PDF_DOC = await loadingTask.promise;
  PAGE_COUNT = PDF_DOC.numPages;
  CURRENT_PAGE = 1;
  $('pageCount').textContent = PAGE_COUNT;
  await renderPage(CURRENT_PAGE);

  // Load matches only (boxes are fetched on demand per table)
  const matches = await fetchJSON(`/api/matches/${encodeURIComponent(slug)}`);
  MATCHES = matches;
  renderMetrics(matches.overall || {});
  renderMatchList(matches.matches || []);
  buildChart(matches.matches || []);
}

async function renderPage(num) {
  CURRENT_PAGE = num;
  const page = await PDF_DOC.getPage(num);
  const viewport = page.getViewport({ scale: SCALE });
  const canvas = $('pdfCanvas');
  const ctx = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  $('overlay').style.width = `${viewport.width}px`;
  $('overlay').style.height = `${viewport.height}px`;

  $('pageNum').textContent = num;
  clearBoxes();
  await page.render({ canvasContext: ctx, viewport }).promise;
}

async function init() {
  // Wait for pdf.js to be available (Safari + module load race safety)
  await (async function waitForPdfjs(maxMs = 5000) {
    const start = performance.now();
    while (!window['pdfjsLib']) {
      if (performance.now() - start > maxMs) throw new Error('pdf.js failed to load');
      await new Promise(r => setTimeout(r, 50));
    }
  })();
  // Load runs
  const runs = await fetchJSON('/api/runs');
  const sel = $('runSelect');
  sel.innerHTML = '';
  for (const r of runs) {
    const opt = document.createElement('option');
    opt.value = r.slug;
    opt.textContent = r.slug; // show only filename slug
    sel.appendChild(opt);
  }
  if (runs.length) {
    sel.value = runs[0].slug;
    await loadRun(runs[0].slug);
  }

  sel.addEventListener('change', async () => {
    await loadRun(sel.value);
  });

  $('prevPage').addEventListener('click', async () => {
    if (!PDF_DOC) return;
    const n = Math.max(1, CURRENT_PAGE - 1);
    await renderPage(n);
    if (LAST_SELECTED_MATCH) drawTargetsOnPage(n, LAST_SELECTED_MATCH, LAST_HIGHLIGHT_MODE === 'best');
  });
  $('nextPage').addEventListener('click', async () => {
    if (!PDF_DOC) return;
    const n = Math.min(PAGE_COUNT, CURRENT_PAGE + 1);
    await renderPage(n);
    if (LAST_SELECTED_MATCH) drawTargetsOnPage(n, LAST_SELECTED_MATCH, LAST_HIGHLIGHT_MODE === 'best');
  });
  $('zoom').addEventListener('input', async (e) => {
    SCALE = Number(e.target.value) / 100;
    await renderPage(CURRENT_PAGE);
    if (LAST_SELECTED_MATCH) drawTargetsOnPage(CURRENT_PAGE, LAST_SELECTED_MATCH, LAST_HIGHLIGHT_MODE === 'best');
  });
  $('drawerClose').addEventListener('click', () => {
    $('drawer').classList.add('hidden');
  });
}

init().catch(err => {
  console.error(err);
  alert(`Failed to initialize UI: ${err.message}`);
});
