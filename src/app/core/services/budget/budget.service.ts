import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { getUrl, getUrlWithId } from '../../../shared/utils';
import { environment } from '../../../../environments/environment';
import {
  Firestore,
  addDoc,
  collection,
  getDocs,
  query,
} from '@angular/fire/firestore';
import { Observable, from, map, of } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class BudgetService {
  private readonly API_URL = environment.apiUrl;
  private readonly MODEL = 'budgets';
  private readonly COLLECTION_PATH = '';

  constructor(
    private httpClient: HttpClient,
    private angularFirestore: Firestore
  ) {}

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
    return from(
      getDocs(query(collection(this.angularFirestore, 'budgets')))
    ).pipe(map((response) => response.docs.map((doc) => doc.data())));
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
