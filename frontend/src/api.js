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

  getRoof: (projectId) => request(`/projects/${projectId}/roof`),
  createRoof: (projectId, data) =>
    request(`/projects/${projectId}/roof`, { method: 'POST', body: JSON.stringify(data) }),
  updateRoof: (projectId, data) =>
    request(`/projects/${projectId}/roof`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRoof: (projectId) =>
    request(`/projects/${projectId}/roof`, { method: 'DELETE' }),

  listOpenings: (projectId) => request(`/projects/${projectId}/openings`),
  createOpening: (projectId, data) =>
    request(`/projects/${projectId}/openings`, { method: 'POST', body: JSON.stringify(data) }),
  updateOpening: (projectId, oid, data) =>
    request(`/projects/${projectId}/openings/${oid}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteOpening: (projectId, oid) =>
    request(`/projects/${projectId}/openings/${oid}`, { method: 'DELETE' }),
};
