// API client for SM Trade backend

const API_BASE = import.meta.env.VITE_API_URL || '/api';

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('sm_auth_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers,
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 401 && !endpoint.startsWith('/auth/login')) {
      onUnauthorized?.();
    }
    throw new Error(err.error || 'API request failed');
  }
  return res.json();
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username: email, email, password }) }),
  me: () => request<{ user: unknown }>('/auth/me'),
  changePassword: (userId: string, currentPassword: string, newPassword: string) =>
    request('/auth/change-password', { method: 'POST', body: JSON.stringify({ userId, currentPassword, newPassword }) }),

  // Users
  getUsers: () => request('/users'),
  createUser: (data: any) => request('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id: string, data: any) => request(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser: (id: string) => request(`/users/${id}`, { method: 'DELETE' }),

  // Customers
  getCustomers: () => request('/customers'),
  createCustomer: (data: any) => request('/customers', { method: 'POST', body: JSON.stringify(data) }),
  updateCustomer: (id: string, data: any) => request(`/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCustomer: (id: string) => request(`/customers/${id}`, { method: 'DELETE' }),

  // Products
  getProducts: () => request('/products'),
  createProduct: (data: any) => request('/products', { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (id: string, data: any) => request(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProduct: (id: string) => request(`/products/${id}`, { method: 'DELETE' }),

  // Invoices
  getInvoices: () => request('/invoices'),
  getInvoice: (id: string) => request(`/invoices/${id}`),
  createInvoice: (data: any) => request('/invoices', { method: 'POST', body: JSON.stringify(data) }),
  updateInvoice: (id: string, data: any) => request(`/invoices/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteInvoice: (id: string) => request(`/invoices/${id}`, { method: 'DELETE' }),

  // Quotations
  getQuotations: () => request('/quotations'),
  getQuotation: (id: string) => request(`/quotations/${id}`),
  createQuotation: (data: any) => request('/quotations', { method: 'POST', body: JSON.stringify(data) }),
  updateQuotation: (id: string, data: any) => request(`/quotations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteQuotation: (id: string) => request(`/quotations/${id}`, { method: 'DELETE' }),

  // Challans
  getChallans: () => request('/challans'),
  getChallan: (id: string) => request(`/challans/${id}`),
  createChallan: (data: any) => request('/challans', { method: 'POST', body: JSON.stringify(data) }),
  updateChallan: (id: string, data: any) => request(`/challans/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteChallan: (id: string) => request(`/challans/${id}`, { method: 'DELETE' }),

  // Purchase Orders
  getPurchaseOrders: () => request('/purchase-orders'),
  getPurchaseOrder: (id: string) => request(`/purchase-orders/${id}`),
  createPurchaseOrder: (data: any) => request('/purchase-orders', { method: 'POST', body: JSON.stringify(data) }),
  updatePurchaseOrder: (id: string, data: any) => request(`/purchase-orders/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePurchaseOrder: (id: string) => request(`/purchase-orders/${id}`, { method: 'DELETE' }),

  // Settings
  getSettings: () => request('/settings'),
  updateSettings: (data: any) => request('/settings', { method: 'PUT', body: JSON.stringify(data) }),

  // Dashboard
  getDashboardStats: () => request('/dashboard/stats'),

  // Public verification
  verifyDocument: (type: string, docId: string) => request(`/verify/${type}/${docId}`),
};
