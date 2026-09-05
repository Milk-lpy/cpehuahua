export type HttpHeaders = Record<string, string | string[]>;

export interface CpeHttpRequest {
  method: "GET" | "POST";
  path: string;
  headers: HttpHeaders;
  body: string | null;
}

export interface CpeHttpResponse {
  status: number;
  headers: HttpHeaders;
  body: string;
  durationMs: number | null;
}

export interface CpeHttpTransport {
  request(request: CpeHttpRequest): Promise<CpeHttpResponse>;
}
