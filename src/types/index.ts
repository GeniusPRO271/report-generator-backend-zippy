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

export interface BaseTransaction {
  id: string;
  merchantName: string;
  provider: string;
  documentId: string | number;
  quantity: string;
  commerceId: string;
  commerceReqId: string;
  email: string;
  name: string;
  request_timestamp: number;
  country: string;
  currency: string;
  payMethod: string;
  payinExpirationTime: string;
  zippy_test: boolean;
  url_OK: string;
  url_ERROR: string;
  dateRequest: Date;
  code: number;
  status: 'pending' | 'ok' | 'error';
}

