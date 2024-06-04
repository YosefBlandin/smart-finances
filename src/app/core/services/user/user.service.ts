import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { getUrl, getUrlWithId } from 'src/app/shared/utils';
import { environment } from 'src/environments/environment.development';
import { IUserDetails, IUserForm } from '../../interfaces/user';
import { IContext, IMeta } from '../api';

@Injectable({
  providedIn: 'root'
})
export class UserService {

  private readonly API_URL = environment.apiUrl;
  private readonly MODEL = 'users';

  constructor(private httpClient: HttpClient) { }

  public create(data: IUserForm) {
    return this.httpClient.post<{ context: IContext, data: IUserDetails }>(getUrl(this.API_URL, `core/${this.MODEL}`), data);
  }

  public patch(data: IUserForm) {
    return this.httpClient.patch<{ context: IContext, data: IUserDetails }>(getUrlWithId({
      url: this.API_URL,
      model: `core/${this.MODEL}`,
      id: data.id
    }), data);
  }

  public all() {
    return this.httpClient.get<{ data: IUserDetails[], context: IContext, meta: IMeta }>(getUrl(this.API_URL, `core/${this.MODEL}`));
  }

  public find(userId: number) {
    return this.httpClient.get<{ data: IUserDetails, context: IContext }>(getUrlWithId({
      url: this.API_URL,
      model: `core/${this.MODEL}`,
      id: userId
    }));
  }

  public delete(userId: number) {
    return this.httpClient.delete<{ data: IUserDetails, context: IContext }>(getUrlWithId({
      url: this.API_URL,
      model: `core/${this.MODEL}/soft-delete`,
      id: userId,
    }))
  }
}
