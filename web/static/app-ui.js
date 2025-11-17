function updateLegend(types) {
  const host = $('legend');
  if (!host) return;
  host.innerHTML = '';
  const use = (types && types.length) ? types : [];
  if (!use.length) { host.classList.add('hidden'); return; }
  for (const t of use.sort()) {
    const row = document.createElement('div');
    row.className = 'item';
    const sw = document.createElement('span');
    sw.className = 'swatch';
    const color = typeBorderColor(t);
    sw.style.background = color;
    row.appendChild(sw);
    const label = document.createElement('span');
    label.textContent = t;
    row.appendChild(label);
    host.appendChild(row);
  }
  host.classList.remove('hidden');
}

function showToast(text, kind='ok', ms=3000) {
  const host = $('toast');
  if (!host) return;
  const item = document.createElement('div');
  item.className = `t ${kind}`;
  item.textContent = text;
  host.appendChild(item);
  setTimeout(() => { item.remove(); }, ms);
}

function typeBorderColor(t) {
  const cls = String(t || '').replace(/[^A-Za-z0-9_-]/g,'');
  if (!cls) return '#6bbcff';
  const fake = document.createElement('div');
  fake.className = `box type-${cls}`;
  document.body.appendChild(fake);
  const color = window.getComputedStyle(fake).borderColor;
  document.body.removeChild(fake);
  return color || '#6bbcff';
}
