export interface ReportRequest {
  userId: string;
  format: 'pdf' | 'csv';
  parameters: Record<string, string | number>;
}

export interface ReportJob {
  id: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  resultUrl?: string;
}

export interface ReportRecord {
  id: string;
  merchantName: string;
  country: string;
  status: string;
  resultUrl?: string;
}
