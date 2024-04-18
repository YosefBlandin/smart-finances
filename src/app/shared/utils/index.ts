export const getUrl = (url: string, model: string): string => {
  return `${url}${model}`;
}

export const getUrlWithId = ({ url, model, id }: { url: string, model: string, id: number }): string => {
  return `${getUrl(url, model)}/${id}`;
}

export const errorMessagesEs: {
  [statusCode: number]: string

} = {
  400: "Datos incorrectos. Verifique los datos ingresados.",
  401: "No autorizado. Verifique sus credenciales.",
  403: "Prohibido. No tiene permiso para acceder a este recurso.",
  404: "Recurso no encontrado. La página o recurso solicitado no existe.",
  405: "Método no permitido. El método utilizado para acceder al recurso no está permitido.",
  406: "No aceptable. El servidor no puede aceptar la solicitud con las características presentadas.",
  408: "Tiempo de espera agotado. La solicitud tardó demasiado en procesarse.",
  413: "Entidad demasiado grande. El tamaño de la solicitud sobrepasa el límite permitido.",
  429: "Demasiadas solicitudes. Ha realizado demasiadas solicitudes en un periodo corto de tiempo. Intente nuevamente más tarde.",
  500: "Error interno del servidor. Algo salió mal en el servidor. Intente nuevamente más tarde.",
  502: "Error de puerta de enlace incorrecta. El servidor no pudo comunicarse con otro servidor.",
  503: "Servicio no disponible. El servidor está sobrecargado o en mantenimiento.",
};
