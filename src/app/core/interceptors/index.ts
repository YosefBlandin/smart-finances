import { errorsInterceptor } from './errors/errors.interceptor';
import { retryInterceptor } from './retry/retry.interceptor';
import { sessionInterceptor } from './session/session.interceptor';

/** Array of Http interceptor providers in outside-in order */
export const httpInterceptorProviders = [
    retryInterceptor,
    errorsInterceptor,
    sessionInterceptor,
];
