// An HTTP API (payload 2.0) event as API Gateway hands it to a handler after the JWT authorizer.
// sub null or undefined: no claims, as for a request the authorizer never saw.
export const httpEvent = (sub, routeKey, { body, pathParameters, queryStringParameters } = {}) => ({
  routeKey,
  requestContext: sub == null ? {} : { authorizer: { jwt: { claims: { sub } } } },
  ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  ...(pathParameters ? { pathParameters } : {}),
  ...(queryStringParameters ? { queryStringParameters } : {}),
});
