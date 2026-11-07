import type { ParameterStore } from '@/ports/parameter-store';

export class MemoryParameterStore implements ParameterStore {
  private readonly values = new Map<string, string>();
  set(name: string, value: string) {
    this.values.set(name, value);
  }
  async get(name: string) {
    return this.values.get(name);
  }
}
