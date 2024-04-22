export const environment = {
    production: false,
    apiUrl: '/api/',
    firebase: {
        apiKey: process.env['API_KEY'],
        authDomain: process.env['AUTH_DOMAIN'],
        databaseURL: process.env['DATABASE_URL'],
        projectId: process.env['PROJECT_ID'],
        appId: process.env['APP_ID'],
        storageBucket: process.env['STORAGE_BUCKET'],
        messagingSenderId: process.env['MESAGGING_SENDER_ID'],
    },
};
