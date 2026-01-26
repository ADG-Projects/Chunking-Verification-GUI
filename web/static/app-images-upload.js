/**
 * Image upload handling and upload pipeline view
 * Extracted from app-images.js for modularity
 */

/* global $, showToast, escapeHtml, initCytoscapeDiagram, openImageLightbox, renderActionDetectionStep,
          CURRENT_UPLOAD_ID, CURRENT_UPLOAD_DATA_URI */

/**
 * Wire up the image upload form.
 */
function wireImageUpload() {
  const form = $('imageUploadForm');
  const input = $('imageUploadInput');
  const dropZone = $('imageUploadZone');

  if (!form || !input) return;

  // File input change
  input.addEventListener('change', () => {
    if (input.files && input.files[0]) {
      uploadImage(input.files[0]);
    }
  });

  // Drag and drop
  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const files = e.dataTransfer?.files;
      if (files && files[0]) {
        uploadImage(files[0]);
      }
    });

    dropZone.addEventListener('click', () => {
      input.click();
    });
  }
}

/**
 * Upload an image (just saves it, doesn't process yet).
 */
async function uploadImage(file) {
  const resultEl = $('imageUploadResult');
  if (!resultEl) return;

  resultEl.innerHTML = '<div class="loading">Uploading image...</div>';

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/figures/upload', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(err.detail || 'Upload failed');
    }

    const data = await res.json();
    window.CURRENT_UPLOAD_ID = data.upload_id;
    window.CURRENT_UPLOAD_DATA_URI = data.original_image_data_uri;

    showToast('Image uploaded successfully', 'success');
    renderUploadPipelineView(data);
  } catch (err) {
    console.error('Upload failed:', err);
    resultEl.innerHTML = `<div class="error">Upload failed: ${escapeHtml(err.message)}</div>`;
    showToast(`Upload failed: ${err.message}`, 'error');
  }
}

/**
 * Fetch and refresh upload details.
 */
async function refreshUploadDetails(uploadId) {
  try {
    const res = await fetch(`/api/figures/upload/${encodeURIComponent(uploadId)}`);
    if (!res.ok) throw new Error('Failed to load upload details');

    const data = await res.json();
    data.original_image_data_uri = window.CURRENT_UPLOAD_DATA_URI;
    renderUploadPipelineView(data);
  } catch (err) {
    console.error('Failed to refresh upload:', err);
  }
}

/**
 * Render the pipeline view for an uploaded image.
 */
function renderUploadPipelineView(data) {
  const resultEl = $('imageUploadResult');
  if (!resultEl) return;

  const stages = data.stages || { uploaded: true, segmented: false, extracted: false };
  const sam3 = data.sam3 || {};
  const processing = data.processing || {};
  const uploadId = data.upload_id;

  // Determine figure type and confidence
  const figureType = processing.figure_type || sam3.figure_type || 'unknown';
  const confidence = (processing.confidence ?? sam3.confidence) != null
    ? `${Math.round((processing.confidence ?? sam3.confidence) * 100)}%`
    : '-';

  // Step states
  const segmentationDone = stages.segmented;
  const extractionDone = stages.extracted;

  // Timing info
  const classificationTime = sam3.classification_duration_ms ? `${sam3.classification_duration_ms}ms` : '-';
  const sam3Time = sam3.sam3_duration_ms ? `${sam3.sam3_duration_ms}ms` : '-';

  resultEl.innerHTML = `
    <div class="upload-pipeline-view">
      <div class="upload-header">
        <h4>Uploaded Image</h4>
        <span class="upload-id">ID: ${uploadId}</span>
        <button class="btn btn-icon" onclick="clearUpload()">×</button>
      </div>

      <div class="upload-content">
        <div class="upload-image-preview">
          <img src="${data.original_image_data_uri || `/api/figures/upload/${uploadId}/image/original`}"
               alt="Original image" class="original-image zoomable-image"
               onclick="openImageLightbox(this.src, 'Original Image')" />
        </div>

        <div class="pipeline-view">
          <div class="pipeline-step step-classification ${segmentationDone ? 'step-complete' : 'step-pending'}">
            <div class="step-header">
              <span class="step-number">${segmentationDone ? '✓' : '1'}</span>
              <span class="step-title">Classification</span>
              <span class="step-time">${classificationTime}</span>
            </div>
            <div class="step-content">
              ${segmentationDone ? `
                <div class="step-result">
                  <span class="type-badge type-${figureType}">${figureType}</span>
                  <span class="confidence-label">Confidence: ${confidence}</span>
                  ${sam3.direction ? `<span class="direction-label">Direction: ${sam3.direction}</span>` : ''}
                </div>
              ` : '<span class="no-data">Run SAM3 to classify</span>'}
            </div>
          </div>

          <div class="pipeline-step step-segmentation ${segmentationDone ? 'step-complete' : 'step-pending'}" id="upload-step-segmentation">
            <div class="step-header">
              <span class="step-number">${segmentationDone ? '✓' : '2'}</span>
              <span class="step-title">SAM3 Segmentation</span>
              <span class="step-time">${sam3Time}</span>
              ${!segmentationDone ? `
                <button class="btn btn-sm btn-primary step-action" onclick="runUploadSegmentation('${uploadId}')">Run SAM3</button>
              ` : `
                <button class="btn btn-sm btn-secondary step-action" onclick="runUploadSegmentation('${uploadId}')" title="Re-run segmentation">Re-run</button>
              `}
            </div>
            <div class="step-content">
              ${segmentationDone ? `
                <div class="step-result">
                  <span class="shape-count">${sam3.shape_count || 0} shapes detected</span>
                </div>
                ${data.has_annotated_image ? `
                  <img src="/api/figures/upload/${uploadId}/image/annotated"
                       alt="SAM3 Annotated"
                       class="annotated-image zoomable-image"
                       onclick="openImageLightbox(this.src, 'SAM3 Annotated Image')"
                       onerror="this.style.display='none'" />
                ` : ''}
              ` : '<span class="no-data">Run SAM3 to detect shapes</span>'}
            </div>
          </div>

          <div class="pipeline-step step-mermaid ${extractionDone ? 'step-complete' : 'step-pending'}" id="upload-step-mermaid">
            <div class="step-header">
              <span class="step-number">${extractionDone ? '✓' : '3'}</span>
              <span class="step-title">Mermaid Extraction</span>
              ${segmentationDone && !extractionDone ? `
                <button class="btn btn-sm btn-primary step-action" onclick="runUploadMermaidExtraction('${uploadId}')">Extract Mermaid</button>
              ` : extractionDone ? `
                <button class="btn btn-sm btn-secondary step-action" onclick="runUploadMermaidExtraction('${uploadId}')" title="Re-run extraction">Re-run</button>
              ` : `
                <button class="btn btn-sm btn-secondary step-action" disabled title="Run SAM3 first">Extract Mermaid</button>
              `}
            </div>
            <div class="step-content">
              ${extractionDone && processing.processed_content && figureType === 'flowchart' ? `
                ${processing.intermediate_nodes ? `
                  <details>
                    <summary>Nodes (${(processing.intermediate_nodes || []).length}) / Edges (${(processing.intermediate_edges || []).length})</summary>
                    <div class="structure-preview">
                      <pre class="json-view">${JSON.stringify(processing.intermediate_nodes, null, 2)}</pre>
                      <pre class="json-view">${JSON.stringify(processing.intermediate_edges, null, 2)}</pre>
                    </div>
                  </details>
                ` : ''}
                <pre class="mermaid-code">${escapeHtml(processing.processed_content)}</pre>
              ` : extractionDone ? `
                <span class="no-data">Mermaid diagram not available (figure type: ${figureType})</span>
              ` : segmentationDone ? `
                <span class="no-data">Click "Extract Mermaid" to generate diagram</span>
              ` : `
                <span class="no-data">Complete SAM3 segmentation first</span>
              `}
            </div>
          </div>

          ${renderActionDetectionStep(processing.intermediate_edges, extractionDone)}
        </div>
      </div>

      ${extractionDone && processing.processed_content && figureType === 'flowchart' ? `
      <div class="cytoscape-section">
        <div class="cytoscape-header">
          <h5>Interactive Graph</h5>
          <div class="cytoscape-controls">
            <button class="btn btn-icon" onclick="cytoscapeZoomIn()" title="Zoom in">+</button>
            <button class="btn btn-icon" onclick="cytoscapeZoomOut()" title="Zoom out">−</button>
            <button class="btn btn-icon" onclick="cytoscapeReset()" title="Reset view">⟲</button>
            <button class="btn btn-icon" onclick="cytoscapeFullscreen()" title="Fullscreen">⛶</button>
          </div>
        </div>
        <div class="cytoscape-container" id="cytoscape-upload-${uploadId}"></div>
      </div>
      ` : ''}

      ${processing.description ? `
      <div class="upload-result-description">
        <h5>Description</h5>
        <p>${escapeHtml(processing.description)}</p>
      </div>
      ` : ''}
    </div>
  `;

  // Initialize Cytoscape if extraction is done and it's a flowchart
  if (extractionDone && processing.processed_content && figureType === 'flowchart') {
    const shapePositions = sam3.shape_positions || [];
    setTimeout(() => {
      initCytoscapeDiagram(
        `cytoscape-upload-${uploadId}`,
        processing.processed_content,
        shapePositions
      );
    }, 100);
  }
}

/**
 * Clear the current upload and reset the upload panel.
 */
function clearUpload() {
  window.CURRENT_UPLOAD_ID = null;
  window.CURRENT_UPLOAD_DATA_URI = null;
  const resultEl = $('imageUploadResult');
  if (resultEl) {
    resultEl.innerHTML = '';
  }
}

// Window exports
window.wireImageUpload = wireImageUpload;
window.uploadImage = uploadImage;
window.refreshUploadDetails = refreshUploadDetails;
window.renderUploadPipelineView = renderUploadPipelineView;
window.clearUpload = clearUpload;
