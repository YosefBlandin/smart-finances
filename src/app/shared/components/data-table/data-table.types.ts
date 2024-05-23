export type DataTableActionType = {
  icon: string;
  actionName: string;
  disabled: boolean;
};

export type DataSourceType<T> = {
  [Property in keyof T]: unknown;
};
