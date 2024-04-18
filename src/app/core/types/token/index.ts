export type TokenKeyType = {
  exp: number
  iat: number
  userId: number
}

export type TokenType<TokenKeyType> = {
  [Property in keyof TokenKeyType]: number
}
