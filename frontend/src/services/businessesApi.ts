
import { supabase } from './supabaseClient';

export type Business = {
  id: string;
  name: string;
  description: string | null;
  target_audience: string | null;
  brand_voice: string | null;
  created_at: string;
};

export type BusinessCreate = {
  name: string;
  description?: string | null;
  target_audience?: string | null;
  brand_voice?: string | null;
  industry?: string | null;
  products_services?: string | null;
  service_area?: string | null;
  website_url?: string | null;
  marketing_goals?: string | null;
  preferred_platforms?: string | null;
  posting_frequency?: string | null;
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || 'http://127.0.0.1:8000';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  // Retrieve the current Supabase session.
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error('Authentication required. Please sign in.');
  }

  // Include the access token in every API request.
  const headers = new Headers(options?.headers);

  const tokenHeader = JSON.parse(
  atob(session.access_token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))
);

console.log('JWT signing algorithm:', tokenHeader.alg);

  headers.set('Authorization', `Bearer ${session.access_token}`);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const details = await response.text();

    throw new Error(
      `Request failed with status ${response.status}: ${details || 'Unknown error'}`,
    );
  }

  return response.json() as Promise<T>;
}

export function getBusinesses(): Promise<Business[]> {
  return request<Business[]>('/businesses');
}

export function createBusiness(data: BusinessCreate): Promise<Business> {
  return request<Business>('/businesses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
}
