import axios, { AxiosInstance } from "axios";

export type HeliusClient = AxiosInstance;

export type PriorityLevel =
    | "Min"
    | "Low"
    | "Medium"
    | "High"
    | "VeryHigh"
    | "UnsafeMax"
    | "Default";

export interface GetPriorityFeeEstimateRequest {
    jsonrpc: "2.0";
    id: string;
    method: "getPriorityFeeEstimate";
    params: GetPriorityFeeEstimateRequestPayload[];
}

interface GetPriorityFeeEstimateRequestPayload {
    transaction?: string;
    accountKeys?: string[];
    options: {
        priorityLevel?: PriorityLevel;
        transactionEncoding?: "base58" | "base64";
        includeAllPriorityFeeLevels?: boolean;
        recommended?: boolean;
    };
}

export interface GetPriorityFeeEstimateResponse {
    jsonrpc: "2.0";
    id?: string;
    result?: {
        priorityFeeEstimate?: number;
        priorityFeeLevels?: Record<
            "min" | "low" | "medium" | "high" | "veryHigh" | "unsafeMax",
            number
        >;
    };
    error?: {
        code: number;
        message: string;
    };
}

export function createHeliusClient(baseUrl: string, timeout: number): HeliusClient {
    return axios.create({
        baseURL: baseUrl,
        timeout,
        headers: {
            "Content-Type": "application/json",
        },
    });
}
