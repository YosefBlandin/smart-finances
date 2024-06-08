import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { getUrl, getUrlWithId } from '../../../shared/utils';
import { environment } from '../../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class ExpenseService {
  private readonly API_URL = environment.apiUrl;
  private readonly MODEL = 'expense';

  constructor(private httpClient: HttpClient) {}

  public create(data: any) {
    return this.httpClient.post<any>(
      getUrl(this.API_URL, `${this.MODEL}/create`),
      data
    );
  }

  public patch(data: any) {
    return this.httpClient.patch<any>(
      getUrlWithId({
        url: this.API_URL,
        model: `${this.MODEL}`,
        id: data.id,
      }),
      data
    );
  }

  public all() {
    return this.httpClient.get<any[]>(getUrl(this.API_URL, `${this.MODEL}`));
  }

  public find(userId: number) {
    return this.httpClient.get<any>(
      getUrlWithId({
        url: this.API_URL,
        model: `${this.MODEL}`,
        id: userId,
      })
    );
  }

  public delete(id: number) {
    return this.httpClient.delete<any>(
      getUrlWithId({
        url: this.API_URL,
        model: `${this.MODEL}`,
        id: id,
      })
    );
  }
}
