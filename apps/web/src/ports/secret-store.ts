export interface SecretStore {
  get(arn: string): Promise<string>;
}
