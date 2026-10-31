// Ports never throw for expected failures; they return a reason instead (architecture.md Contracts "Ports").
export type Ok<T extends object = object> = { ok: true } & T;
export type Fail<R extends string = string> = { ok: false; reason: R };
export type Result<T extends object = object, R extends string = string> = Ok<T> | Fail<R>;
