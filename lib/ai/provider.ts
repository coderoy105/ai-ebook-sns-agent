export type StructuredRequest<T> = {
  model: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  system: string;
  prompt: string;
  parse: (value: unknown) => T;
  webSearch?: boolean;
  signal?: AbortSignal;
};

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  model: string;
  requestId?: string;
};

export type StructuredResponse<T> = {
  value: T;
  usage: ModelUsage;
  raw: unknown;
};

export interface LlmProvider {
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>>;
  embed(input: string): Promise<number[]>;
}

export function estimateOpenAICost(model: string, inputTokens: number, outputTokens: number) {
  const rate = model.includes("mini")
    ? { input: 0.25, output: 2 }
    : { input: 1.25, output: 10 };
  return ((inputTokens / 1_000_000) * rate.input) + ((outputTokens / 1_000_000) * rate.output);
}
