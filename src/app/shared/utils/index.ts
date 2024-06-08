export const getUrl = (url: string, model: string): string => {
  return `${url}${model}`;
};

export const getUrlWithId = ({
  url,
  model,
  id,
}: {
  url: string;
  model: string;
  id: number;
}): string => {
  return `${getUrl(url, model)}/${id}`;
};

export const errorMessagesEn: {
  [statusCode: number]: string;
} = {
  400: 'Invalid Data. Please review the information you entered.',
  401: 'Unauthorized Access. Please check your credentials.',
  403: 'Forbidden Access. You do not have permission to access this resource.',
  404: 'Resource Not Found. The requested page or resource does not exist.',
  405: 'Method Not Allowed. The method used to access the resource is not permitted.',
  406: 'Not Acceptable. The server cannot accept the request with the provided specifications.',
  408: 'Request Timeout. The request took too long to process.',
  413: 'Payload Too Large. The request size exceeds the allowed limit.',
  429: 'Too Many Requests. You have made too many requests in a short period of time. Please try again later.',
  500: 'Internal Server Error. Something went wrong on the server. Please try again later.',
  502: 'Bad Gateway Error. The server was unable to communicate with another server.',
  503: 'Service Unavailable. The server is overloaded or under maintenance.',
};
