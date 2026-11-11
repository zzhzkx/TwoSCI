export type AttemptStatus = 'success' | 'miss' | 'error' | 'blocked';

export interface DownloadAttempt {
  channel: string;
  status: AttemptStatus;
  reason?: string;
  url?: string;
}

export interface PdfFetchOptions {
  doi?: string;
  landingUrl?: string;
  record?: {
    pdfUrl?: string;
    openAccess?: boolean;
    url?: string;
  };
  elsevierApiKey?: string;
  email?: string;
  minBytes?: number;
  timeoutMs?: number;
}

export interface PdfFetchResult {
  success: boolean;
  channel?: string;
  url?: string;
  attempts: DownloadAttempt[];
  message?: string;
}
