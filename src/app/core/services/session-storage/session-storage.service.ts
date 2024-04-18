import { Injectable, signal } from '@angular/core';
import * as forge from 'node-forge';

@Injectable({
  providedIn: 'root',
})
export class SessionStorageService {
  private readonly storage: Storage | null;
  private readonly sessionKey$ = signal<string>('');
  private readonly iv$ = signal<string>('');

  constructor() {
    this.storage = sessionStorage;
    this.iv$.set("3e57953b570738bd44ef42db9a2f05c5");
    this.sessionKey$.set("faf368ffd79c5a6707945c56f5397ff4");
  }

  get sessionKey(): string {
    return this.sessionKey$();
  }

  get iv(): string {
    return this.iv$();
  }

  private encrypt(data: string): string {
    if (data) {
      const cipher = forge.cipher.createCipher(
        "AES-CBC",
        forge.util.hexToBytes(this.sessionKey)
      );
      cipher.start({ iv: forge.util.hexToBytes(this.iv) });
      cipher.update(forge.util.createBuffer(data));
      cipher.finish();
      const encryptedData = cipher.output.toHex();
      return encryptedData;
    }
    return '';
  }

  private decrypt(data: string): string {
    const decipher = forge.cipher.createDecipher('AES-CBC', forge.util.hexToBytes(this.sessionKey));
    decipher.start({ iv: forge.util.hexToBytes(this.iv) });
    decipher.update(forge.util.createBuffer(forge.util.hexToBytes(data)));
    decipher.finish();
    const decrypted = decipher.output.data;
    return JSON.parse(decrypted);
  }

  public getItem(key: string): { [key: string]: unknown } | { [key: string]: unknown }[] | string | number | null {
    const value: string | null = sessionStorage.getItem(this.encrypt(key));
    if (value) {
      return this.decrypt(value);
    }

    return null
  }

  public setItem(key: string, data: { [key: string]: unknown } | { [key: string]: unknown }[] | string | number): void {
    this.storage?.setItem(
      this.encrypt(key),
      this.encrypt(JSON.stringify(data))
    );
  }

  public removeItem(key: string): void {
    this.storage?.removeItem(this.encrypt(key));
  }

  public clear(): void {
    this.storage?.clear();
  }

  private generateRandomStr(): string {
    return forge.util.bytesToHex(forge.random.getBytesSync(16));
  }
}
