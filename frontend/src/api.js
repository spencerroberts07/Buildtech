const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function getToken() {
  return localStorage.getItem('token');
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    let msg = 'Request failed';
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  login: (username, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  changePassword: (currentPassword, newPassword) =>
    request('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  verifyPassword: (password) =>
    request('/auth/verify-password', { method: 'POST', body: JSON.stringify({ password }) }),

  getSystemSettings: () => request('/system-settings'),
  updateSystemSetting: (key, value) =>
    request(`/system-settings/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ value }) }),

  listMaterialDeletions: (projectId) => request(`/projects/${projectId}/deletions`),
  createMaterialDeletion: (projectId, data) =>
    request(`/projects/${projectId}/deletions`, { method: 'POST', body: JSON.stringify(data) }),
  deleteMaterialDeletion: (projectId, did) =>
    request(`/projects/${projectId}/deletions/${did}`, { method: 'DELETE' }),

  materialListWithDeleted: (projectId) => request(`/projects/${projectId}/material-list?include_deleted=1`),

  listMaterials: () => request('/materials'),
  createMaterial: (data) => request('/materials', { method: 'POST', body: JSON.stringify(data) }),
  updateMaterial: (id, data) => request(`/materials/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteMaterial: (id) => request(`/materials/${id}`, { method: 'DELETE' }),

  listAssemblies: () => request('/assemblies'),
  getAssembly: (id) => request(`/assemblies/${id}`),
  createAssembly: (data) => request('/assemblies', { method: 'POST', body: JSON.stringify(data) }),
  updateAssembly: (id, data) => request(`/assemblies/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAssembly: (id) => request(`/assemblies/${id}`, { method: 'DELETE' }),

  listProjects: () => request('/projects'),
  getProject: (id) => request(`/projects/${id}`),
  createProject: (data) => request('/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id, data) => request(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),

  addMeasurement: (projectId, data) =>
    request(`/projects/${projectId}/measurements`, { method: 'POST', body: JSON.stringify(data) }),
  updateMeasurement: (projectId, mid, data) =>
    request(`/projects/${projectId}/measurements/${mid}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteMeasurement: (projectId, mid) =>
    request(`/projects/${projectId}/measurements/${mid}`, { method: 'DELETE' }),

  materialList: (projectId) => request(`/projects/${projectId}/material-list`),

  getSettings: () => request('/settings'),
  updateSettings: (data) => request('/settings', { method: 'PUT', body: JSON.stringify(data) }),

  getProjectSettings: (id) => request(`/projects/${id}/settings`),
  updateProjectSettings: (id, data) =>
    request(`/projects/${id}/settings`, { method: 'PUT', body: JSON.stringify(data) }),

  listWalls: (projectId) => request(`/projects/${projectId}/walls`),
  createWall: (projectId, data) =>
    request(`/projects/${projectId}/walls`, { method: 'POST', body: JSON.stringify(data) }),
  updateWall: (projectId, wid, data) =>
    request(`/projects/${projectId}/walls/${wid}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteWall: (projectId, wid) =>
    request(`/projects/${projectId}/walls/${wid}`, { method: 'DELETE' }),

  listFloorPlans: (projectId) => request(`/projects/${projectId}/floor-plans`),
  getFloorPlan: (projectId, fpid) => request(`/projects/${projectId}/floor-plans/${fpid}`),
  createFloorPlan: (projectId, data = {}) =>
    request(`/projects/${projectId}/floor-plans`, { method: 'POST', body: JSON.stringify(data) }),
  updateFloorPlan: (projectId, fpid, data) =>
    request(`/projects/${projectId}/floor-plans/${fpid}`, { method: 'PUT', body: JSON.stringify(data) }),
  updateFloorPlanWall: (projectId, fpid, widx, data) =>
    request(`/projects/${projectId}/floor-plans/${fpid}/walls/${widx}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteFloorPlanWall: (projectId, fpid, widx) =>
    request(`/projects/${projectId}/floor-plans/${fpid}/walls/${widx}`, { method: 'DELETE' }),
  copyFloorPlanLevel: (projectId, from_level, to_level) =>
    request(`/projects/${projectId}/floor-plans/copy-level`, {
      method: 'POST', body: JSON.stringify({ from_level, to_level }),
    }),

  listInteriorWalls: (projectId, fpid) =>
    request(`/projects/${projectId}/floor-plans/${fpid}/interior-walls`),
  createInteriorWall: (projectId, fpid, data) =>
    request(`/projects/${projectId}/floor-plans/${fpid}/interior-walls`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  updateInteriorWall: (projectId, fpid, iwid, data) =>
    request(`/projects/${projectId}/floor-plans/${fpid}/interior-walls/${iwid}`, {
      method: 'PUT', body: JSON.stringify(data),
    }),
  deleteInteriorWall: (projectId, fpid, iwid) =>
    request(`/projects/${projectId}/floor-plans/${fpid}/interior-walls/${iwid}`, { method: 'DELETE' }),

  getRoof: (projectId) => request(`/projects/${projectId}/roof`),
  createRoof: (projectId, data) =>
    request(`/projects/${projectId}/roof`, { method: 'POST', body: JSON.stringify(data) }),
  updateRoof: (projectId, data) =>
    request(`/projects/${projectId}/roof`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRoof: (projectId) =>
    request(`/projects/${projectId}/roof`, { method: 'DELETE' }),

  // Polygon-based roof sections (replacing the simple width/depth roofs row).
  listRoofSections: (projectId) => request(`/projects/${projectId}/roof-sections`),
  createRoofSection: (projectId, data) =>
    request(`/projects/${projectId}/roof-sections`, { method: 'POST', body: JSON.stringify(data) }),
  updateRoofSection: (projectId, sid, data) =>
    request(`/projects/${projectId}/roof-sections/${sid}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRoofSection: (projectId, sid) =>
    request(`/projects/${projectId}/roof-sections/${sid}`, { method: 'DELETE' }),
  updateRoofSectionEdge: (projectId, sid, eid, data) =>
    request(`/projects/${projectId}/roof-sections/${sid}/edges/${eid}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Decks (polygon + framing settings + stairs).
  listDecks: (projectId) => request(`/projects/${projectId}/decks`),
  createDeck: (projectId, data) =>
    request(`/projects/${projectId}/decks`, { method: 'POST', body: JSON.stringify(data) }),
  updateDeck: (projectId, did, data) =>
    request(`/projects/${projectId}/decks/${did}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDeck: (projectId, did) =>
    request(`/projects/${projectId}/decks/${did}`, { method: 'DELETE' }),
  createDeckStair: (projectId, did, data) =>
    request(`/projects/${projectId}/decks/${did}/stairs`, { method: 'POST', body: JSON.stringify(data) }),
  updateDeckStair: (projectId, did, sid, data) =>
    request(`/projects/${projectId}/decks/${did}/stairs/${sid}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDeckStair: (projectId, did, sid) =>
    request(`/projects/${projectId}/decks/${did}/stairs/${sid}`, { method: 'DELETE' }),

  listSkuCatalog: () => request('/sku-catalog'),

  listCustomers: () => request('/customers'),
  getCustomer: (id) => request(`/customers/${id}`),
  listCustomerProjects: (id) => request(`/customers/${id}/projects`),
  createCustomer: (data) => request('/customers', { method: 'POST', body: JSON.stringify(data) }),
  updateCustomer: (id, data) => request(`/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCustomer: (id) => request(`/customers/${id}`, { method: 'DELETE' }),

  uploadPdf: async (projectId, file) => {
    const fd = new FormData();
    fd.append('pdf', file);
    const headers = {};
    const token = localStorage.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}/projects/${projectId}/upload-pdf`, {
      method: 'POST', headers, body: fd,
    });
    if (!res.ok) {
      let msg = 'Upload failed';
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  },
  fetchPdfBlob: async (projectId) => {
    const headers = {};
    const token = localStorage.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}/projects/${projectId}/pdf`, { headers });
    if (res.status === 404) {
      let body = {};
      try { body = await res.json(); } catch {}
      const err = new Error(body.error || 'pdf not found');
      err.code = body.error;
      throw err;
    }
    if (!res.ok) throw new Error('Failed to load PDF');
    return res.blob();
  },
  deletePdf: (projectId) => request(`/projects/${projectId}/pdf`, { method: 'DELETE' }),

  // Engineered truss layout PDF — separate slot from the architectural pdf.
  uploadTrussPdf: async (projectId, file) => {
    const fd = new FormData();
    fd.append('pdf', file);
    const headers = {};
    const token = localStorage.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}/projects/${projectId}/upload-truss-pdf`, {
      method: 'POST', headers, body: fd,
    });
    if (!res.ok) {
      let msg = 'Upload failed';
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  },
  deleteTrussPdf: (projectId) => request(`/projects/${projectId}/truss-pdf`, { method: 'DELETE' }),

  // AI roof extraction.
  getExtractionStatus: (projectId) => request(`/projects/${projectId}/extraction-status`),
  extractRoofData: (projectId) =>
    request(`/projects/${projectId}/extract-roof-data`, { method: 'POST', body: '{}' }),
  applyExtractedRoofData: (projectId, data) =>
    request(`/projects/${projectId}/apply-extracted-roof-data`, { method: 'POST', body: JSON.stringify(data) }),
  clearExtractedRoofData: (projectId) =>
    request(`/projects/${projectId}/extracted-roof-data`, { method: 'DELETE' }),

  // AI floor plan extraction.
  extractFloorPlan: (projectId, opts = {}) =>
    request(`/projects/${projectId}/extract-floor-plan`, {
      method: 'POST', body: JSON.stringify({}),
      signal: opts.signal,
    }),
  extractOpeningsOnly: (projectId, opts = {}) =>
    request(`/projects/${projectId}/extract-openings-only`, {
      method: 'POST', body: JSON.stringify({}),
      signal: opts.signal,
    }),
  applyFloorPlanExtraction: (projectId, data) =>
    request(`/projects/${projectId}/apply-floor-plan-extraction`, {
      method: 'POST', body: JSON.stringify(data),
    }),

  // ---- Training-data collection (admin) ----
  saveTrainingExample: (projectId, data) =>
    request(`/projects/${projectId}/save-training-example`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  listTrainingExamples: () => request('/admin/training-examples'),
  deleteTrainingExample: (id) => request(`/admin/training-examples/${id}`, { method: 'DELETE' }),
  rateTrainingExample: (id, data) =>
    request(`/admin/training-examples/${id}/rating`, { method: 'PUT', body: JSON.stringify(data) }),
  trainingExampleStats: () => request('/admin/training-examples/stats'),
  aiStatus: () => request('/admin/ai-status'),
  // Exports a JSONL file as a blob — caller turns it into a download.
  exportTrainingJsonl: async () => {
    const headers = {};
    const token = localStorage.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}/admin/training-examples/export`, { headers });
    if (!res.ok) {
      let msg = 'Export failed';
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const fileMatch = cd.match(/filename="([^"]+)"/);
    return { blob, filename: fileMatch ? fileMatch[1] : 'training-export.jsonl' };
  },

  listPackages: (projectId) => request(`/projects/${projectId}/packages`),
  createPackage: (projectId, data) =>
    request(`/projects/${projectId}/packages`, { method: 'POST', body: JSON.stringify(data) }),
  updatePackage: (projectId, pid, data) =>
    request(`/projects/${projectId}/packages/${pid}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePackage: (projectId, pid) =>
    request(`/projects/${projectId}/packages/${pid}`, { method: 'DELETE' }),

  getFloor: (projectId) => request(`/projects/${projectId}/floor`),
  createFloor: (projectId, data) =>
    request(`/projects/${projectId}/floor`, { method: 'POST', body: JSON.stringify(data) }),
  updateFloor: (projectId, data) =>
    request(`/projects/${projectId}/floor`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteFloor: (projectId) =>
    request(`/projects/${projectId}/floor`, { method: 'DELETE' }),

  listOverrides: (projectId) => request(`/projects/${projectId}/overrides`),
  upsertOverride: (projectId, data) =>
    request(`/projects/${projectId}/overrides`, { method: 'POST', body: JSON.stringify(data) }),
  deleteOverride: (projectId, oid) =>
    request(`/projects/${projectId}/overrides/${oid}`, { method: 'DELETE' }),

  listOpenings: (projectId) => request(`/projects/${projectId}/openings`),
  createOpening: (projectId, data) =>
    request(`/projects/${projectId}/openings`, { method: 'POST', body: JSON.stringify(data) }),
  updateOpening: (projectId, oid, data) =>
    request(`/projects/${projectId}/openings/${oid}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteOpening: (projectId, oid) =>
    request(`/projects/${projectId}/openings/${oid}`, { method: 'DELETE' }),

  // Quotes
  listQuotes: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/quotes${qs ? '?' + qs : ''}`);
  },
  listProjectQuotes: (projectId) => request(`/projects/${projectId}/quotes`),
  generateQuote: (projectId, data) =>
    request(`/projects/${projectId}/quotes`, { method: 'POST', body: JSON.stringify(data) }),
  getQuote: (qid) => request(`/quotes/${qid}`),
  updateQuote: (qid, data) =>
    request(`/quotes/${qid}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteQuote: (qid) => request(`/quotes/${qid}`, { method: 'DELETE' }),
  adjustQuote: (qid, data) =>
    request(`/quotes/${qid}/adjust`, { method: 'POST', body: JSON.stringify(data) }),
  resetQuotePrices: (qid) => request(`/quotes/${qid}/reset`, { method: 'POST' }),
  addQuoteLineItem: (qid, data) =>
    request(`/quotes/${qid}/line-items`, { method: 'POST', body: JSON.stringify(data) }),
  deleteQuoteLineItem: (qid, liid) =>
    request(`/quotes/${qid}/line-items/${liid}`, { method: 'DELETE' }),
  // Manual per-row price override. Pass { unit_price } or { reset: true }.
  updateQuoteLineItem: (qid, liid, data) =>
    request(`/quotes/${qid}/line-items/${liid}`, { method: 'PUT', body: JSON.stringify(data) }),
  // Per-row visibility toggle.
  setQuoteLineItemVisibility: (qid, liid, hidden) =>
    request(`/quotes/${qid}/line-items/${liid}/visibility`, { method: 'PUT', body: JSON.stringify({ hidden }) }),
  // Bulk visibility for "hide entire section".
  bulkSetQuoteLineItemVisibility: (qid, ids, hidden) =>
    request(`/quotes/${qid}/line-items/visibility-bulk`, { method: 'PUT', body: JSON.stringify({ ids, hidden }) }),

  // SKU search (full warehouse catalog)
  skuSearch: (q, limit = 20) =>
    request(`/sku-search?q=${encodeURIComponent(q)}&limit=${limit}`),

  // Send a quote by email (Resend on the backend, with PDF attached).
  sendQuoteEmail: (qid, data) =>
    request(`/quotes/${qid}/send`, { method: 'POST', body: JSON.stringify(data) }),

  // Quote PDF — fetches the binary as a blob (auth header is required).
  fetchQuotePdf: async (qid) => {
    const headers = {};
    const token = localStorage.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}/quotes/${qid}/pdf`, { headers });
    if (!res.ok) {
      let msg = 'PDF generation failed';
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    return res.blob();
  },
};
