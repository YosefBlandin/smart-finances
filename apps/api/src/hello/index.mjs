export const handler = async () => ({
  statusCode: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: 'smart-finances api is alive', stage: process.env.STAGE }),
});
