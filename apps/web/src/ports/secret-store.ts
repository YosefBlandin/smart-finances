// A secret's plain string by its ARN (D-73, D-115). The real adapter reads Secrets Manager through the compute role
// and caches each value for 5 minutes. A failed read rejects; the error never carries a secret value.
export interface SecretStore {
  get(arn: string): Promise<string>;
}
