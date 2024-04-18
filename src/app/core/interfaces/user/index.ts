export interface IUserDetails {
  id: number;
  identificationType: string;
  identification: string;
  name: string;
  localPhone: string | undefined;
  cellPhone: string;
  email: string;
  username: string;
  password?: string | undefined;
  apiKey: string;
  apiSecret: string;
  avatar: string | undefined;
  createdAt: string;
  updatedAt: string;
  statusId: number;
  channelId: number;
}

export interface IUserForm {
  id: number,
  identificationType: string;
  identification: string,
  name: string,
  localPhone: string,
  cellPhone: string,
  email: string,
  username: string,
  password?: string | undefined,
  channelId: number,
  statusId: number
}
