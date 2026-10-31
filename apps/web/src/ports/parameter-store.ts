// Stage parameters; the real adapter caches each value for 60 seconds.
export interface ParameterStore {
  get(name: string): Promise<string | undefined>;
}
