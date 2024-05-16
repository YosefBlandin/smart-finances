import { errorsInterceptor } from './errors/errors.interceptor';
import { retryInterceptor } from './retry/retry.interceptor';
import { sessionInterceptor } from './session/session.interceptor';

export const httpInterceptorProviders = [
    retryInterceptor,
    errorsInterceptor,
    sessionInterceptor,
];
