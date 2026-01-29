/**
 * Element card building, image section, and details drawer
 * Extracted from app-elements.js for modularity
 */

async function openElementDetails(elementId) {
  try {
    const data = await fetchJSON(withProvider(`/api/element/${encodeURIComponent(CURRENT_SLUG)}/${encodeURIComponent(elementId)}`));
    const container = $('preview');
    resetDrawerScrollState();
    CURRENT_INSPECT_ELEMENT_ID = elementId;
    refreshElementOverlaysForCurrentPage();
    CURRENT_ELEMENT_DRAWER_ID = elementId;
    CURRENT_CHUNK_DRAWER_ID = null;
    $('drawerTitle').textContent = 'Element';
    const displayId = data.original_element_id || elementId;
    $('drawerMeta').innerHTML = `<code>${displayId}</code> · <span class="chip-tag">${data.type || '-'}</span>`;
    $('drawerSummary').innerHTML = '';
    $('elementPicker').innerHTML = '';
    $('drawer').classList.remove('hidden');
    document.body.classList.add('drawer-open');
    container.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'preview-meta';
    head.innerHTML = `<span class="badge">Element</span><span>page: ${data.page_number ?? '-'}</span>`;
    container.appendChild(head);
    const structure = document.createElement('div');
    structure.className = 'element-structure';
    const crumbs = [
      '<span class="crumb">Document</span>',
      `<span class="crumb">Page ${data.page_number ?? '-'}</span>`,
      `<span class="crumb">${data.type || 'Element'}</span>`,
    ];
    structure.innerHTML = crumbs.join(' › ');
    container.appendChild(structure);

    // Hierarchy Section
    if (CURRENT_PAGE_BOXES) {
      const outlineEntries = sortElementEntries(Object.entries(CURRENT_PAGE_BOXES || {}))
        .map(([id, entry]) => [id, entry, getReview('element', id)]);
      const hierarchySection = buildElementHierarchySection(elementId, outlineEntries);
      if (hierarchySection) container.appendChild(hierarchySection);
    }

    container.appendChild(buildDrawerReviewSection('element', elementId));
    const imageSection = buildElementImageSection(data);
    if (imageSection) {
      container.appendChild(imageSection);
    }
    const html = data.text_as_html;
    if (html) {
      const scroll = document.createElement('div');
      scroll.className = 'drawer-markdown';
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;
      scroll.appendChild(wrapper);
      if (wrapper.querySelector('table')) {
        applyTablePreviewDirection(wrapper);
      }
      applyDirectionalText(scroll);
      container.appendChild(scroll);
    } else if ((data.type || '').toLowerCase() === 'figure') {
      // For Figure elements, fetch and display figure understanding
      const figureContainer = document.createElement('div');
      figureContainer.className = 'figure-understanding-section';
      container.appendChild(figureContainer);
      // Fetch figure understanding asynchronously
      fetchFigureUnderstandingForElement(CURRENT_SLUG, elementId, figureContainer);
    } else {
      const md = await renderMarkdownSafe(data.text);
      if (md) {
        const scroll = document.createElement('div');
        scroll.className = 'drawer-markdown';
        const body = document.createElement('div');
        body.className = 'markdown-body';
        body.innerHTML = md;
        scroll.appendChild(body);
        applyDirectionalText(body);
        container.appendChild(scroll);
      } else {
        const pre = document.createElement('pre');
        pre.textContent = data.text || '(no text)';
        applyDirectionalText(pre);
        container.appendChild(pre);
      }
    }
  } catch (e) {
    showToast(`Failed to load element: ${e.message}`, 'err');
  }
}

/**
 * Fetch figure understanding for an element and display it.
 * @param {string} slug - The run slug
 * @param {string} elementId - The figure element ID
 * @param {HTMLElement} container - Container to render into
 */
async function fetchFigureUnderstandingForElement(slug, elementId, container) {
  try {
    const provider = CURRENT_PROVIDER || 'azure/document_intelligence';
    const url = `/api/figures/${encodeURIComponent(slug)}/${encodeURIComponent(elementId)}?provider=${encodeURIComponent(provider)}`;
    const data = await fetchJSON(url);

    if (data.formatted_understanding) {
      renderFigureUnderstandingForElement(data.formatted_understanding, container);
    } else if (data.processing) {
      // Fallback: build a simple display from processing data
      const figType = data.processing.figure_type || 'Unknown';
      const desc = data.processing.description || data.processing.processed_content || '';
      if (desc) {
        const pre = document.createElement('pre');
        pre.textContent = `[Figure: ${figType} - ${desc}]`;
        applyDirectionalText(pre);
        container.appendChild(pre);
      } else {
        const pre = document.createElement('pre');
        pre.textContent = '(no figure understanding available)';
        container.appendChild(pre);
      }
    } else {
      const pre = document.createElement('pre');
      pre.textContent = '(no figure understanding available)';
      container.appendChild(pre);
    }
  } catch (e) {
    // Figure understanding not available
    console.debug('Could not fetch figure understanding for element:', e);
    const pre = document.createElement('pre');
    pre.textContent = '(figure understanding not processed)';
    container.appendChild(pre);
  }
}

/**
 * Render formatted figure understanding into a container for element view.
 * @param {string} text - The formatted understanding text
 * @param {HTMLElement} container - Container to render into
 */
function renderFigureUnderstandingForElement(text, container) {
  if (!text) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'figure-understanding-element';

  // Check if there's a mermaid code block
  const mermaidMatch = text.match(/```mermaid\n([\s\S]*?)```/);

  if (mermaidMatch) {
    // Split into description part and mermaid part
    const parts = text.split(/```mermaid\n[\s\S]*?```/);
    const descPart = parts[0].trim();
    const mermaidCode = mermaidMatch[1].trim();

    // Add description
    if (descPart) {
      const descEl = document.createElement('div');
      descEl.className = 'figure-understanding-desc';
      descEl.textContent = descPart;
      wrapper.appendChild(descEl);
    }

    // Add mermaid code block (expanded by default for element view)
    const codeSection = document.createElement('div');
    codeSection.className = 'figure-understanding-mermaid-section';

    const codeHeader = document.createElement('div');
    codeHeader.className = 'figure-understanding-mermaid-header';
    codeHeader.textContent = 'Mermaid Code';
    codeSection.appendChild(codeHeader);

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = mermaidCode;
    pre.appendChild(code);
    codeSection.appendChild(pre);

    wrapper.appendChild(codeSection);
  } else {
    // No mermaid block, just show the text
    const pre = document.createElement('pre');
    pre.textContent = text;
    applyDirectionalText(pre);
    wrapper.appendChild(pre);
  }

  container.appendChild(wrapper);
}

function buildElementHierarchySection(elementId, entries) {
  if (!Array.isArray(entries) || !entries.length) return null;
  const entryMap = new Map(entries.map(([id, entry]) => [id, entry]));
  if (!entryMap.has(elementId)) return null;
  const { sorted, childMap, childIds } = buildElementHierarchy(entries);
  const allowed = new Set([elementId]);
  const badgeLookup = new Map();
  const typeCounters = {};
  const parentMap = new Map();
  for (const [pid, children] of childMap.entries()) {
    for (const [cid] of children) parentMap.set(cid, pid);
  }
  const ancestorList = [];
  let cursor = elementId;
  while (parentMap.has(cursor)) {
    const pid = parentMap.get(cursor);
    ancestorList.unshift(pid);
    allowed.add(pid);
    cursor = pid;
  }
  const collectDesc = (id) => {
    const kids = childMap.get(id) || [];
    for (const [cid] of kids) {
      if (!allowed.has(cid)) {
        allowed.add(cid);
        collectDesc(cid);
      }
    }
  };
  collectDesc(elementId);
  const filteredSorted = sorted.filter(([id]) => allowed.has(id));
  for (const [id, entry] of filteredSorted) {
    const t = entry?.type || 'Unknown';
    typeCounters[t] = (typeCounters[t] || 0) + 1;
    badgeLookup.set(id, `${outlineLabelForType(t)} ${typeCounters[t]}`);
  }
  const ancestorSet = new Set(ancestorList);
  const defaultExpanded = new Set([...ancestorSet]);
  const localExpansion = new Map();
  const isExpanded = (id) => {
    if (localExpansion.has(id)) return localExpansion.get(id);
    return defaultExpanded.has(id);
  };
  const setExpanded = (id, val) => {
    localExpansion.set(id, !!val);
  };
  let collapsed = false;
  const wrap = document.createElement('div');
  wrap.className = 'element-hierarchy-section';
  const title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = 'Hierarchy context';
  wrap.appendChild(title);
  const tree = document.createElement('div');
  tree.className = 'element-hierarchy-tree';
  wrap.appendChild(tree);
  const outline = document.createElement('div');
  outline.className = 'elements-outline-page elements-outline-page-embedded';
  tree.appendChild(outline);
  const head = document.createElement('div');
  head.className = 'elements-outline-page-head';
  const titleEl = document.createElement('div');
  titleEl.className = 'elements-outline-title';
  const pageNum = Number(entries[0]?.[1]?.page_trimmed || CURRENT_PAGE || 1);
  titleEl.textContent = `Page ${pageNum}`;
  head.appendChild(titleEl);
  const counts = document.createElement('div');
  counts.className = 'elements-outline-counts';
  counts.textContent = ELEMENT_OUTLINE_ORDER
    .map((o) => {
      const count = filteredSorted.filter(([, entry]) => (entry?.type || '') === o.type).length;
      return count ? `${o.label} ${count}` : null;
    })
    .filter(Boolean)
    .join(' · ');
  if (!counts.textContent) counts.textContent = `${filteredSorted.length} elements`;
  head.appendChild(counts);
  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'outline-toggle';
  const updateCollapseLabel = () => {
    collapseBtn.textContent = collapsed ? 'Expand' : 'Collapse';
  };
  updateCollapseLabel();
  collapseBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    body.classList.toggle('collapsed', collapsed);
    updateCollapseLabel();
  });
  head.appendChild(collapseBtn);
  outline.appendChild(head);
  const body = document.createElement('div');
  body.className = 'elements-outline-body';
  outline.appendChild(body);
  const allowedChildIds = new Set();
  for (const [pid, children] of childMap.entries()) {
    if (!allowed.has(pid)) continue;
    children.forEach(([cid]) => allowedChildIds.add(cid));
  }
  const renderRows = (parentEl, nodes) => {
    for (const [id, entry, review] of nodes) {
      if (!allowed.has(id)) continue;
      const t = entry?.type || 'Unknown';
      const row = document.createElement('div');
      row.className = 'elements-outline-row';
      const left = document.createElement('div');
      left.className = 'elements-outline-left';
      const badge = document.createElement('span');
      badge.className = 'outline-badge';
      badge.textContent = badgeLookup.get(id) || outlineLabelForType(t);
      left.appendChild(badge);
      row.appendChild(left);
      const cardWrap = document.createElement('div');
      cardWrap.className = 'elements-outline-card';
      const card = buildElementCard(id, entry, review, { compact: true });
      if (id === elementId) {
        card.classList.add('hierarchy-current');
      } else if (ancestorSet.has(id)) {
        card.classList.add('hierarchy-ancestor');
      }
      const children = (childMap.get(id) || []).filter(([cid]) => allowed.has(cid));
      if (children.length) {
        row.classList.add('outline-has-children');
        card.classList.add('has-children');
        const expanded = isExpanded(id);
        if (expanded) card.classList.add('children-expanded');
        const summary = summarizeChildren(children);
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'outline-child-toggle';
        const updateText = (next) => {
          toggle.textContent = next
            ? summary ? `Hide children (${summary})` : 'Hide children'
            : summary ? `Show children (${summary})` : 'Show children';
        };
        updateText(expanded);
        const childWrap = document.createElement('div');
        childWrap.className = 'elements-outline-children';
        if (!expanded) {
          childWrap.classList.add('hidden');
        } else {
          renderRows(childWrap, children);
        }
        toggle.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const next = childWrap.classList.contains('hidden');
          setExpanded(id, next);
          childWrap.classList.toggle('hidden', !next);
          if (next && !childWrap.childElementCount) {
            renderRows(childWrap, children);
          }
          card.classList.toggle('children-expanded', next);
          updateText(next);
        });
        card.appendChild(toggle);
        cardWrap.appendChild(card);
        cardWrap.appendChild(childWrap);
      } else {
        cardWrap.appendChild(card);
      }
      row.appendChild(cardWrap);
      parentEl.appendChild(row);
    }
  };
  const roots = filteredSorted.filter(([id]) => allowed.has(id) && !allowedChildIds.has(id));
  renderRows(body, roots);
  setTimeout(() => {
    const card = wrap.querySelector('.element-card.hierarchy-current');
    if (card) {
      try {
        card.scrollIntoView({ block: 'center' });
      } catch (e) { }
    }
  }, 0);
  return wrap;
}

async function findStableIdByOrig(origId, page) {
  try {
    const boxes = await fetchJSON(withProvider(`/api/boxes/${encodeURIComponent(CURRENT_SLUG)}?page=${page}`));
    for (const [eid, entry] of Object.entries(boxes)) {
      if (entry.orig_id && entry.orig_id === origId) return eid;
    }
  } catch (e) { }
  return null;
}

function buildElementCard(id, entry, review, opts = {}) {
  const compact = !!opts.compact;
  const card = document.createElement('div');
  card.className = 'chunk-card element-card';
  if (compact) card.classList.add('element-card-compact');
  if (review && review.rating) {
    card.classList.add('has-review');
    card.classList.add(review.rating === 'good' ? 'review-good' : 'review-bad');
  }
  card.dataset.elementId = id;
  const color = typeBorderColor(entry.type || '');
  card.style.borderLeft = `4px solid ${color}`;
  const header = document.createElement('div');
  header.className = 'header element-card-head';
  const metaWrap = document.createElement('div');
  metaWrap.className = 'element-card-meta';
  const dId = entry.orig_id || id;
  const short = dId.length > 16 ? `${dId.slice(0, 12)}…` : dId;
  metaWrap.innerHTML = `<span>${entry.type || 'Unknown'}</span><span class="meta">${short}</span>`;
  header.appendChild(metaWrap);
  header.appendChild(buildReviewButtons('element', id, 'card'));
  const pre = document.createElement('pre');
  pre.textContent = 'Loading preview…';
  applyDirectionalText(pre);
  card.appendChild(header);
  const notePreview = buildNotePreview('element', id, 'mini');
  if (notePreview) {
    notePreview.title = 'Open element details to edit note';
    notePreview.addEventListener('click', (ev) => {
      ev.stopPropagation();
      card.click();
    });
    card.appendChild(notePreview);
  }
  card.appendChild(pre);
  if (id === CURRENT_INSPECT_ELEMENT_ID) card.classList.add('focused');
  card.addEventListener('click', async () => {
    CURRENT_INSPECT_ELEMENT_ID = id;
    const p = Number(entry.page_trimmed || CURRENT_PAGE);
    if (p && p !== CURRENT_PAGE) {
      await renderPage(p);
    }
    await drawBoxesForCurrentPage();
    openElementDetails(id);
  });
  (async () => {
    try {
      const data = await fetchJSON(withProvider(`/api/element/${encodeURIComponent(CURRENT_SLUG)}/${encodeURIComponent(id)}`));
      let txt = data.text || '';
      if (!txt && data.text_as_html) {
        txt = String(data.text_as_html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
      // For Figure elements, try to get figure understanding
      if (!txt && (data.type || '').toLowerCase() === 'figure') {
        try {
          const provider = CURRENT_PROVIDER || 'azure/document_intelligence';
          const figUrl = `/api/figures/${encodeURIComponent(CURRENT_SLUG)}/${encodeURIComponent(id)}?provider=${encodeURIComponent(provider)}`;
          const figData = await fetchJSON(figUrl);
          if (figData.formatted_understanding) {
            // Extract just the bracketed description part (first line)
            const firstLine = figData.formatted_understanding.split('\n')[0];
            txt = firstLine || figData.formatted_understanding;
          } else if (figData.processing) {
            const figType = figData.processing.figure_type || 'Figure';
            const desc = figData.processing.description || figData.processing.processed_content || '';
            if (desc) {
              const shortDesc = desc.length > 150 ? desc.slice(0, 150) + '…' : desc;
              txt = `[Figure: ${figType} - ${shortDesc}]`;
            }
          }
        } catch (figErr) {
          console.debug('Could not fetch figure understanding for card:', figErr);
        }
      }
      if (!txt) txt = '(no text)';
      pre.textContent = txt;
      const displayId = data.original_element_id || id;
      const shortId = displayId.length > 16 ? `${displayId.slice(0, 12)}…` : displayId;
      metaWrap.innerHTML = `<span>${data.type || entry.type || 'Element'}</span><span class="meta">${shortId}</span>`;
    } catch (e) {
      pre.textContent = `(failed to load preview: ${e.message})`;
    }
  })();
  return card;
}

function buildElementImageSection(data) {
  const mime = data.image_mime_type || 'image/png';
  const uri = data.image_data_uri || (data.image_base64 ? `data:${mime};base64,${data.image_base64}` : null);
  const fallbackUrl = data.image_url;
  if (!uri && !fallbackUrl) return null;
  const wrap = document.createElement('div');
  wrap.className = 'drawer-image';
  const title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = 'Extracted image';
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.alt = data.type ? `${data.type} image` : 'Extracted image';
  img.src = uri || fallbackUrl;
  wrap.appendChild(title);
  wrap.appendChild(img);
  return wrap;
}

// Window exports
window.openElementDetails = openElementDetails;
window.buildElementHierarchySection = buildElementHierarchySection;
window.findStableIdByOrig = findStableIdByOrig;
window.buildElementCard = buildElementCard;
window.buildElementImageSection = buildElementImageSection;
