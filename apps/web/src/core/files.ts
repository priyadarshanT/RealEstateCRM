import type { Schemas } from '@crm/contracts';
import { api, unwrap } from './api';

// File upload (API guide §7): ask for an upload ticket, PUT the bytes to the storage URL, then mark it complete.

export type UploadPurpose = Schemas['UploadRequest']['purpose'];

export async function uploadFile(file: File, purpose: UploadPurpose): Promise<string> {
  const ticket = unwrap(
    await api.POST('/files/uploads', {
      body: { fileName: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size, purpose },
    }),
  );
  const headers = new Headers(Object.entries((ticket.headers ?? {}) as Record<string, string>));
  if (!headers.has('content-type')) headers.set('content-type', file.type || 'application/octet-stream');
  const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers, body: file });
  if (!put.ok) throw new Error(`Upload failed (${put.status}).`);
  unwrap(await api.POST('/files/{id}/complete', { params: { path: { id: ticket.fileId } } }));
  return ticket.fileId;
}

export async function openDownload(fileId: string): Promise<void> {
  const link = unwrap(await api.GET('/files/{id}/download', { params: { path: { id: fileId } } }));
  window.open(link.url, '_blank', 'noopener');
}
